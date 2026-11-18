# Stage 1: Build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:22-alpine AS backend-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Stage 3: Build the SAP helper against the ipatool revision pinned in go.mod
FROM golang:1.26-alpine AS sap-auth-build
RUN apk add --no-cache gcc g++ musl-dev
WORKDIR /src
COPY sap-auth/go.mod sap-auth/go.sum ./
RUN go mod download
COPY sap-auth/ ./
RUN go run ./tools/overlay && CGO_ENABLED=1 go build -modfile=bridge.mod -mod=readonly -trimpath -o /out/asspp-sap-auth .

# Stage 4: Runtime
FROM node:22-alpine
RUN apk add --no-cache zip libstdc++
WORKDIR /app
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./
COPY --from=frontend-build /app/frontend/dist ./public
COPY --from=sap-auth-build /out/asspp-sap-auth /usr/local/bin/asspp-sap-auth
RUN mkdir -p /data/packages
EXPOSE 8080
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown
ENV DATA_DIR=/data XDG_CACHE_HOME=/data/cache PORT=8080 BUILD_COMMIT=$BUILD_COMMIT BUILD_DATE=$BUILD_DATE
CMD ["node", "dist/index.js"]
