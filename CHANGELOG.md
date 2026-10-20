# Changelog

## 1.1.1 — 2026-10-20

- Read historical app version numbers from the selected IPA's main
  `Payload/*.app/Info.plist` using bounded HTTP Range requests, supporting XML
  and binary plists without downloading the complete IPA.
- Always use that ZIP entry's modification timestamp for historical dates.
  Ignore Store metadata and plist `releaseDate`/`ReleaseDate` fields, which can
  describe another version. Label the date as “IPA ZIP modified date” and show
  its UTC calendar date consistently across browser time zones.
- Match Go's ZIP timestamp handling for extended Unix, NTFS, and DOS timestamps,
  including unsigned Unix timestamps after 2038. Report unreadable metadata
  instead of substituting another date source.
- Record the required Codex author and committer identity in `AGENTS.md`.

Validation includes real ZIP fixtures with XML/binary plists, conflicting and
invalid release dates, ZIP timestamp formats, Range response and redirect
checks, and browser-side version query fallbacks. Frontend/backend unit suites,
TypeScript checks and production builds, plus Go helper tests/build are run.
Live Apple account downloads are outside the automated fixture tests.

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
