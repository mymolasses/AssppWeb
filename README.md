# AssppWeb

A web-based tool for acquiring and installing iOS apps outside the App Store. Authenticate with your Apple ID, search for apps, acquire licenses, and install IPAs directly to your device.

![preview](./resources/preview.png)

## Authentication architecture in this fork

This fork uses a server-side ipatool SAP helper for Apple ID authentication. During login and reauthentication, your email, password, optional verification code, and cookies are sent to this instance over HTTPS. The helper keeps its account/keychain and cookies in memory; it caches SAP runtime assets separately under `/data/cache`.

After login, purchase, download-info, and version requests still use browser-side libcurl.js WASM TLS through the Wisp relay. The backend downloads and prepares IPA files and serves installation links. Self-host this fork or use an instance whose operator you trust, and use HTTPS.

See [UPSTREAM_SYNC.md](UPSTREAM_SYNC.md) for the exact upstream revisions and integration scope.

## Quick Start

### Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mymolasses/AssppWeb&apiTokenTmpl=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22write%22%7D%2C%7B%22key%22%3A%22containers%22%2C%22type%22%3A%22write%22%7D%2C%7B%22key%22%3A%22cloudchamber%22%2C%22type%22%3A%22write%22%7D%5D&apiTokenName=AssppWeb%20Deploy)

This uses Cloudflare Workers + Containers and builds this fork's Dockerfile, including the pinned SAP helper.

Requirements:

- Cloudflare Workers **Paid** plan (Containers are not available on Free).
- Deploy/build token with:
  - `Workers Scripts Edit`
  - `Containers Edit`
  - `Cloudchamber Edit`

If your build log fails at `Deploy a container application` with `Unauthorized`, your build token is missing required Containers/Cloudchamber permissions.

### Deploy to Railway

<details>
<summary>Click to show Railway deployment instructions</summary>

1. Go to [railway.com/new/image](https://railway.com/new/image) → enter `ghcr.io/mymolasses/assppweb:latest`
2. In service **Settings**, set **Healthcheck Path** to `/api/settings` and deploy
3. Right-click the service → **Attach volume** → mount path: `/data`
4. In **Variables**, set `DATA_DIR` = `/data` and deploy
5. In **Settings** → **Networking**, generate a public domain or add a custom domain

**Notes**

- The free trial works but has limitations (volume expiry, network restrictions). **Hobby** plan ($5/month) or above is recommended for reliable use.
- Enable [**Serverless**](https://docs.railway.com/deployments/serverless) in service settings to scale down to zero during idle periods
- Railway [auto-updates](https://docs.railway.com/deployments/image-auto-updates) `:latest` images from GHCR — new releases will be deployed automatically within a few hours

> **⚠️ Custom domain with Cloudflare:** Railway's Cloudflare integration creates DNS records with Proxy enabled (orange cloud) by default. After authorizing, go to Cloudflare DNS settings and switch the CNAME record to **DNS only** (gray cloud) — Railway handles TLS automatically. If you keep Cloudflare Proxy on, you must set SSL/TLS mode to **Full** (not Flexible or Full Strict), otherwise you'll get an infinite redirect loop. See [Railway docs](https://docs.railway.com/networking/troubleshooting/ssl#err_too_many_redirects).

</details>

### Self-Host with Docker Compose

<details>
<summary>Click to show manual Docker Compose setup instructions</summary>

**Setup Docker Compose**

```bash
git clone https://github.com/mymolasses/AssppWeb.git
cd AssppWeb
docker compose up --build -d
```

The checked-in Compose file builds the local source and tags it as `ghcr.io/mymolasses/assppweb:latest`. It does not deploy the original author's image.

**Environment Variables**

| Variable                                    | Default         | Description                                                                                 |
| ------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `PORT`                                      | `8080`          | Server listen port                                                                          |
| `DATA_DIR`                                  | `./data`        | Directory for storing compiled IPAs                                                         |
| `PUBLIC_BASE_URL`                           | _(auto-detect)_ | Public URL for generating install manifests (e.g. `https://asspp.example.com`)              |
| `UNSAFE_DANGEROUSLY_DISABLE_HTTPS_REDIRECT` | `false`         | Disable HTTPS redirect (see warning below)                                                  |
| `AUTO_CLEANUP_DAYS`                         | `0`             | Automatically delete cached IPA files older than specified days (0 to disable)              |
| `AUTO_CLEANUP_MAX_MB`                       | `0`             | Automatically delete oldest cached IPA files when size exceeds this MB limit (0 to disable) |
| `MAX_DOWNLOAD_MB`                           | `0`             | Reject downloads exceeding this size in MB to prevent out-of-memory errors (0 to disable)   |
| `DOWNLOAD_THREADS`                          | `8`             | Number of parallel threads for IPA downloads (1–32)                                         |
| `ACCESS_PASSWORD`                           | _(none)_        | Require a password to access the web UI and API (empty to disable)                          |
| `LOCAL_IPA_PASSWORD` | `1234` | Password for local IPA uploads and details |
| `SAP_AUTH_HELPER_PATH` | `/usr/local/bin/asspp-sap-auth` | Path to the SAP authentication helper |
| `SAP_AUTH_TIMEOUT_MS` | `300000` | Helper process timeout in milliseconds |

**Reverse Proxy (Required for Install Apps on iOS)**

iOS requires HTTPS for `itms-services://` install links. You must put AssppWeb behind a reverse proxy with a valid TLS certificate.

> **⚠️ Redirect loop (`ERR_TOO_MANY_REDIRECTS`)?** Some reverse proxies (e.g. NAS built-in proxies) always send `X-Forwarded-Proto: http` even when the client connected via HTTPS, causing an infinite redirect loop. If you cannot configure your proxy to send the correct header, set `UNSAFE_DANGEROUSLY_DISABLE_HTTPS_REDIRECT=true` as a last resort. **This disables the HTTP→HTTPS redirect — you must ensure your proxy enforces HTTPS externally.**

The following is an example Caddyfile configuration:

```
asspp.example.com { reverse_proxy 127.0.0.1:8080 }
```

**⚠️ Make Sure WebSocket Works**

AssppWeb relies on the Wisp protocol over WebSocket (`/wisp/`) for browser-side Store requests. Ensure your reverse proxy or CDN (e.g., Nginx, Cloudflare) is configured to allow WebSocket connections, otherwise the app will fail to communicate with Apple servers.

</details>

## Security Recommendations

**DDoS Protection**

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

<img src="./Artworks/fable5.jpg" alt="Fable 5 Verified" width="240">
