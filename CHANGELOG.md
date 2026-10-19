# Changelog

## 1.1.0 — 2026-10-19

- Pin the SAP helper to the official ipatool 2.7.0 release.
- Add browser-side ent/download requests with native kbsync generation,
  account/device-scoped memory caching, and one-time rejected-cache recovery.
- Unify downloads and version queries around bounded volumeStore, redownload,
  and updateProduct fallbacks, preserving session cookies and historical versions.
- Resolve current iOS versions through enterprise and consumer catalogs,
  including the public App Store catalog fallback for Apple Arcade apps.
- Validate download app/version identity and prevent token-bearing requests
  from following redirects. Add bounded Store requests and cancellation guards.

Apple Store TLS continues to terminate in the browser through Wisp. The backend
kbsync operation receives only DSID and device ID and does not persist blobs.
Real-account Apple downloads and native StoreAgent execution require deployment
validation; automated protocol tests use fixtures and injected generators.
