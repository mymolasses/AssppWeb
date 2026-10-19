# Upstream synchronization — 2026-09-06

## Storefront link repair — 2026-10-12

The region link now uses the HTTPS `resetAndRedirect` route found in the user's
shared [App Store region shortcut](https://www.icloud.com/shortcuts/67efad4a8afb41ef825b56478e86e43e).
Unlike an ordinary apps.apple.com link, it requests a storefront reset using
`dsf`. The shortcut's fixed app ID is replaced by the displayed app ID. The
nested `viewSoftware` URL is fully encoded: in a public Apple endpoint probe,
the original unescaped query lost the app ID while the encoded version retained
the app ID and country and returned `X-Set-Apple-Store-Front: 143463-2,8` for HK.
A normal apps.apple.com link remains as a separate web fallback.

The public protocol response includes a Reset action and `signout=true`.
This alone does not establish how a current iPhone handles its saved Apple
Account: the user reports that their shortcut switches browsing storefronts
without logging out. Account retention and navigation still need real-device
validation; switching the browsing storefront does not grant cross-region purchases.

## Authentication repair — 2026-10-09

The SAP helper now pins official ipatool commit `e3932cec31765b025b8e3edd6797e9e69c3c3fa8`
(`v2.6.1-0.20261007230230-e3932cec3176`), rather than the v2.6.0 release.
This includes 2FA input/error handling (735b689), signed POST preservation across
301/302/307/308 redirects (1ec8b3e), bounded authentication requests and transport
retries (e258fed), initial authentication path normalization (f9aa653), and
phone-number account storefront routing (93b527a).

Fork-specific adaptation: the one-shot helper returns its cookie jar with login
errors, and the backend forwards it to the browser. Add-account and reauthentication
forms keep these cookies in component memory for the next verification request;
unsuccessful logins are not saved as accounts. SAP signers still have the same
per-Login lifetime as official ipatool. No credentials or challenge cookies are
stored by the backend.

Reauthentication preserves the device ID throughout a challenge and only permits
the existing fresh-cookie fallback before 2FA begins. Verification failures must
not silently start a password-only login. A fresh-code response clears the old
input and keeps the verification field visible. Account/password changes reset
the add-account challenge; changing the detail route clears pending state.

Validation uses mock challenges and fixture cookies; live Apple authentication
still requires testing against the deployed helper and the user's network.

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

## ipatool v2.6.0 follow-up — 2026-09-19

The SAP authentication helper now pins the official `github.com/majd/ipatool/v2 v2.6.0` release. This brings its improved handling of unexpected Apple authentication responses and the Linux glibc/musl runtime fix into the server-side helper.

The Web download path already had the `updateProduct` recovery needed for empty `volumeStore` responses. Three additional v2.6.0 reliability changes were adapted to the Web architecture:

- Apple download responses without SINF data are accepted. The backend treats license injection as optional and can still add available iTunes metadata before completing the package.
- Concurrent downloads verify a real `bytes=0-0` response before splitting the file, and every chunk must return the exact requested `Content-Range`. A server that advertises but ignores Range now uses the single-stream path instead of concatenating duplicate full responses.
- Apple-provided artwork is downloaded from allowlisted Apple or mzstatic HTTPS hosts, size-limited, and added to the IPA root as `iTunesArtwork`.

Native macOS downloads, purchase listing, jailbroken-iOS binaries, and interactive CLI prompts are not exposed by AssppWeb's SAP-only Go helper. ipatool's custom ZIP framing was not copied because AssppWeb updates IPA entries with the system `zip` utility rather than raw-copying ZIP records, so that implementation and its bug do not apply here.

Local IPA tasks now persist the browser-supplied original filename separately from the IPA's embedded application name. They may also persist an optional display name, editable from package details. The display name is used in download cards, notifications, generated filenames, share metadata, and OTA manifest titles; clearing it restores the embedded IPA name. Existing task records remain valid because both fields are optional.

## ipatool v2.7.0 browser Store adaptation — 2026-10-19

The SAP helper now pins official `github.com/majd/ipatool/v2 v2.7.0`. Login still
invokes the library's `Login` once and retains the fork's 2FA challenge cookies.

Downloads, version listing, and version metadata now share one browser-side
Store request implementation. The preferred path reads the bag's
`volumeStoreDownloadProduct` URL and validates the exact HTTPS dispatch host
and `/WebObjects/DownloadDispatch.woa/wa/ent/download` path before use. It sends
the account token, storefront, pinned version, hardware-derived serial, and
kbsync using ipatool 2.7.0's payload and headers. Redirects from this request
are rejected, so the token is never forwarded to another destination.

To preserve this fork's architecture, a separate `/api/apple/kbsync` operation
accepts only DSID and device ID. The existing one-shot Go helper calls pinned
ipatool SAP asset/machine routines to generate the blob with a two-minute bound;
it does not perform Apple Store requests. The browser caches only blobs that
produced a validated response, keyed by DSID/device ID. A rejected cached blob
is invalidated and regenerated once; a rejected fresh blob goes directly to the
legacy chain. No blob, token, or cookies are persisted by this server operation.
Asset caches remain non-credential native runtime files, as with SAP login.

If the preferred path is missing or fails, recovery uses volumeStore,
redownload, then the bag's updateProduct, at most once per endpoint. Legacy
5002 recovery is retained. Recovery also recognizes the observed message-only
`No Longer Available` response and an empty HTTP 500 from redownload. Pinned
redownload/update requests use `appExtVrsId`; volumeStore uses
`externalVersionId`. Update and preferred responses must contain exactly one
item matching the app ID, bundle ID, and external version ID. Explicitly
mismatched legacy metadata is rejected too. Cookies survive endpoint changes
and validated legacy redirects.

Unpinned dispatch requests first resolve an iOS version using the account's
storefront: MDM catalogs `ios`, `iphone`, then `ipad`, followed by the public
App Store JSON catalog for apps absent from MDM (including Apple Arcade).
These metadata requests carry no account cookies or tokens. This Web UI has
no explicit iPhone/iPad platform selector, so the public catalog also tries an
iPad offer when the iPhone offer is absent. Requested historical versions are
never replaced by the current version lookup.

Reference checked: ApplePackage's `StoreDownloadEndpoint+Fetch.swift` on main
still documents volumeStore-to-redownload recovery for 5002. The preferred
kbsync path, catalog recovery, updateProduct handling, and identity checks here
are deliberate adaptations of official ipatool v2.7.0 rather than changes to
that Swift behavior. Native Mac/watchOS/tvOS UI expansion is outside this change.

Validation covers malformed and unavailable endpoints, version identity,
credential-free catalog/signature requests, per-account/device cache isolation,
rejected-cache regeneration, non-forwarding token redirects, retained cookies,
and bounded fallbacks. Frontend/backend suites, type checks and builds, plus
Go helper tests/build are checked. Protocol tests use fixtures and injected
native generators; they do not establish success with a live Apple account or
exercise the downloaded Apple StoreAgent binary against a real account.
## Historical version metadata — 2026-10-19

Historical version details now follow ipatool's IPA reader instead of trusting
`songList[0].metadata`, which can contain stale version numbers and dates. The
browser still obtains the selected version's download URL using the account's
Store session, then passes only that URL to the authenticated backend metadata
route. The backend uses HTTP Range requests to read the ZIP directory and the
main `Payload/*.app/Info.plist`, supporting XML and binary plists without a full
IPA download. Version numbers come from `CFBundleShortVersionString` (with
`bundleShortVersionString` fallback). Dates come from `releaseDate`/`ReleaseDate`,
with the ZIP entry modification date as fallback, as in ipatool.

Deliberate UI difference: the response carries `dateSource`; a ZIP timestamp is
labelled “File modified (not release date)”, while a package date is labelled
“Release date (package field)”. Metadata failures do not fall back to stale Store
metadata. Range responses, redirect hosts, read size, and plist size are checked.
