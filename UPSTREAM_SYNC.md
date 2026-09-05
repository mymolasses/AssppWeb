# Upstream synchronization — 2026-09-06

## Sources

- Fork baseline: `mymolasses/AssppWeb` main at `75201f9`.
- AssppWeb: `Lakr233/AssppWeb` main at `3bc9515ba5df2d02c06fc827dc85232473be9274` (UI refresh and redownload host allowlist).
- SAP helper dependency: `majd/ipatool` main at `a9bd16c9a211c556650e206245ff34115c725e12`, pinned as `v2.5.1-0.20260903223411-a9bd16c9a211` in Go modules.
- Additional empty-response workaround: `HaughtyEyes/ipatool` branch `fix-empty-volume-store-response`, commit `bad372d`. This is a contributor patch, **not merged into official ipatool main** at synchronization time. See [ipatool issue #538 discussion](https://github.com/majd/ipatool/issues/538#issuecomment-5521765024) and [source comparison](https://github.com/majd/ipatool/compare/main...HaughtyEyes:ipatool:fix-empty-volume-store-response).

The fork's upstream baseline `78a0be7` and canonical upstream `c683fee` have the identical tree `f550d28823f3150afdc326ff70ac744a98954cf2`. Their rewritten history was reconciled before merging current upstream. The previous local `deploy/main` branch was retained; integration is on `sync/upstreams-2026-09-05`.

## Download and version history repair

Apple's volumeStore endpoint can return HTTP 200 with no `songList` and no error metadata. Previously the Web client reported “no items in response” immediately. Download, version listing, and version metadata lookup now retry once through the existing redownload endpoint in this precise case. The existing error `5002` fallback remains supported.

The fallback retains cookies, the device identifier, and DSID headers. A requested historical version uses `externalVersionId` for volumeStore and `appExtVrsId` for redownload. Real Apple errors and non-200 responses do not trigger the new empty-response retry. An empty fallback response terminates instead of looping.

The Go contributor implementation discovers redownload through Apple's bag. AssppWeb already defines that endpoint, so this adaptation reuses its existing endpoint configuration. Upstream's Wisp allowlist update permits `downloaddispatch.itunes.apple.com`, which is required for browser transport to reach it.

The SAP helper now delegates authentication retries to the current ipatool library. Persistent `5002` download failures can trigger existing reauthentication. Mac purchase errors do not retry with the iOS GAME pricing parameter.

## Preserved fork behavior

The new upstream UI retains SAP login, account and search preferences, cross-region account selection, local IPA upload and password gate, signing details, and retained orphaned downloads. New download-list quick actions are hidden for local uploads so they cannot bypass the existing detail gate. Native Mac downloads remain unavailable in the Web UI; updating the Go authentication dependency does not expose every ipatool CLI feature.

Docker builds use the pinned Go module with `-mod=readonly`. Compose builds this fork's local source and tags `ghcr.io/mymolasses/assppweb:latest`. Documentation describes the fork's server-assisted SAP authentication accurately.

## Validation and limits

Regression coverage includes empty/missing item lists, one-time fallback, historical version payloads, cookies across redirects, real errors, HTTP failures, login delegation, account preference retention, local IPA gating, and the Wisp destination allowlist. Frontend/backend type checks, test suites, frontend production build, and Go helper tests/build are run before completing the integration.

Tests use fixtures, not a real Apple account. They verify the retry behavior but cannot establish that Apple will return a usable fallback response for every account or app. Docker deployment and live download/version-history checks require the running instance. No remote push or deployment is part of this local synchronization.
