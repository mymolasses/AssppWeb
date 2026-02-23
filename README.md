# AssppWeb

A web-based tool for acquiring and installing iOS apps outside the App Store. Authenticate with your Apple ID, search for apps, acquire licenses, and install IPAs directly to your device.

![preview](./resources/preview.png)

## Zero-Trust Architecture

AssppWeb uses a zero-trust design where the server **never sees your Apple credentials**. All Apple API communication happens directly in your browser via WebAssembly (libcurl.js with Mbed TLS 1.3). The server only acts as a blind TCP relay (Wisp protocol) and handles IPA compilation from public CDN downloads.

> **⚠️ Important Security Notice:** While the backend cannot read your encrypted traffic, a malicious host could serve a modified frontend to capture your credentials before encryption. Therefore, **do not blindly trust public instances**. We strongly recommend self-hosting your own instance or using one provided by a trusted partner. Always verify the SSL certificate and ensure you are connecting to a secure, authentic endpoint.

**恳请所有转发项目的博主对自己的受众进行网络安全技术科普。要有哪个不拎清的大头儿子搞出事情来都够我们喝一壶的。**

## Quick Start

### Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Lakr233/AssppWeb/tree/main/cloudflare)

This uses Cloudflare Workers + Containers and reuses this repo's Docker build.

Manual deploy:

```bash
cd cloudflare
npm install
npx wrangler login
npm run deploy
```

### Docker Compose

```bash
curl -O https://raw.githubusercontent.com/Lakr233/AssppWeb/main/compose.yml
docker compose up -d
```

The app will be available at `http://localhost:8080`.

## Environment Variables

| Variable          | Default         | Description                                                                    |
| ----------------- | --------------- | ------------------------------------------------------------------------------ |
| `PORT`            | `8080`          | Server listen port                                                             |
| `DATA_DIR`        | `./data`        | Directory for storing compiled IPAs                                            |
| `PUBLIC_BASE_URL` | _(auto-detect)_ | Public URL for generating install manifests (e.g. `https://asspp.example.com`) |

## Reverse Proxy (Required for iOS)

iOS requires HTTPS for `itms-services://` install links. You must put AssppWeb behind a reverse proxy with a valid TLS certificate.

> **⚠️ WebSocket Required:** AssppWeb relies on the Wisp protocol over WebSocket (`/wisp/`) for its zero-trust architecture. Ensure your reverse proxy or CDN (e.g., Nginx, Cloudflare) is configured to allow WebSocket connections, otherwise the app will fail to communicate with Apple servers.

### Caddy

```
asspp.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

## DDoS Protection

IPA files can be hundreds of megabytes. If your instance is publicly accessible, put it behind a CDN like Cloudflare to absorb bandwidth and prevent abuse.

## License

MIT License. See [LICENSE](LICENSE) for details.

## 🥰 Acknowledgments

For projects that was stolen and used heavily:

- [ipatool](https://github.com/majd/ipatool)
- [Asspp](https://github.com/Lakr233/Asspp)

For friends who helped with testing and feedback:

- [@lbr77](https://github.com/lbr77)
- [@akinazuki](https://github.com/akinazuki)
