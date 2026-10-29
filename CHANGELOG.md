# Changelog

## 1.2.1 — 2026-10-29

- Persist normalized download storefront IDs and provenance with package records,
  including across restarts and public sharing without exposing owner identities.
- Show saved regions and region-specific App Store links on other devices;
  region filters include public packages. Missing/unrecognized regions show Unknown.
- Recover explicit storefront metadata from existing IPA files at startup.
  Devices with matching saved accounts also backfill missing regions in the
  background; account-derived regions are labelled as inferred in details.
- Preserve saved regions over later account changes. Keep favorites, sharing,
  original retention timestamps and local IPA protection unchanged.

## 1.2.0 — 2026-10-29

- Backport ipatool 7578671: when iOS catalogs confirm HTTP 404, allow one
  same-account redownload without a version pin. Keep identity checks, bounded
  requests, structured auth/license errors, and explicit historical version pins.
- Backport ipatool 1b9ff28: accept legacy iOS IPAs with a missing platform
  declaration. Reject empty, malformed, or incompatible declarations and wrong
  bundle IDs before publishing a downloaded package.
- Keep the server-side SAP login helper pinned at ipatool 2.7.0; retain favorites,
  14-day cleanup/grace, global visibility, local IPA gating and existing accounts.
- Show the package version on Home and Settings and expose it through settings.
  Shared app cards remain in Downloads and are removed from Home.
- Publish versioned/latest images only from version tags, with complete Linux
  frontend/backend/SAP validation required before the image build.

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
