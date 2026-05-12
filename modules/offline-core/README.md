# OfflineCore

Standalone Swift Package providing iOS primitives for the encrypted offline
audio playback feature.

## Status

Plan 2 of 4 (`docs/superpowers/plans/2026-05-12-offline-ios-core.md`). This
package is pure Swift — it has no React Native or Expo dependency. Plan 4
will wrap it as an Expo module and wire `OfflineSchemeHandler` into the
WebView used by the RN demo's `PersistentPlayer.tsx`.

## Public surface

```swift
import OfflineCore

// One per app instance.
let service = try OfflineService(
    rootDirectory: FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("offline")
)

// After fetching {license, ciphertextUrl, sizeBytes} from /offline/license,
// and after downloading ciphertextUrl to a temp file:
try service.ingestDownload(
    tmpFileURL: downloadedURL,
    license: licenseJWT,
    sizeBytes: sizeBytesFromResponse,
    metaJSON: optionalMetaJSONString
)

let rows = try service.listTracks()
let exists = try service.hasTrack(trackId: "5400863209100:1:1")
try service.removeTrack(trackId: "5400863209100:1:1")
try service.wipeAll()

// Wire into WebView (Plan 4 will do this — must run on MainActor):
let handler = service.makeSchemeHandler(deviceIdProvider: { currentDeviceId() })
let config = WKWebViewConfiguration()
config.setURLSchemeHandler(handler, forURLScheme: OfflineSchemeHandler.scheme)
let webView = WKWebView(frame: .zero, configuration: config)
// Player JS uses `offline://<percent-encoded-trackId>/audio.m4a`.
```

## URL construction note

The trackId format is `cb:disc:track` (e.g. `5400863209100:1:1`). Foundation's
`URL(string:)` parser treats unescaped colons in the authority as port
separators, so JS code constructing the URL must percent-encode the trackId:

```js
const url = `offline://${encodeURIComponent(trackId)}/audio.m4a`
```

The scheme handler receives the URL via WKWebView, which percent-decodes
`url.host` back to the original `cb:disc:track` string before our handler
reads it.

## Trust model

- License JWT signature is NOT verified on-device. The worker is the trust
  boundary; TLS protects the JWT in transit. The device only base64-decodes
  the JWT body to extract `{trackId, mid, deviceId, userId, key, iv, exp,
  iat, v}`.
- The Keychain master key is hardware-backed when the device supports it
  (Secure Enclave). Wrapping uses AES-256-GCM (CryptoKit).
- The scheme handler enforces, in order: catalog hit → 404 if missing;
  `deviceId` match → 403 + row deletion if not; `license_exp` not in the
  past → 410 if expired; KeyVault unwrap → 410 if the master key has been
  wiped or rotated.

## Testing

```bash
cd modules/offline-core
swift test
```

Runs on macOS (host platform). Tests do NOT need a simulator. Keychain
tests run against the host keychain — first run may prompt for access if
the user has not already granted it.

The current suite has 30 tests covering license decoding, AES-CTR counter
math, Keychain wrap/unwrap, SQLite CRUD, file IO + pread, scheme handler
status codes and Range alignment, downloader rollback, and the service
facade end-to-end.

## Concurrency notes (Swift 6)

`OfflineSchemeHandler` conforms to `WKURLSchemeHandler`, which is
`@MainActor`-isolated under Swift 6 strict concurrency. Therefore:

- `OfflineService.makeSchemeHandler(deviceIdProvider:)` is `@MainActor`.
- All other `OfflineService` methods are unisolated and safe to call from
  any task.

In practice WebKit invokes scheme handler callbacks on its own queue, so
even though the type is MainActor-isolated, the actual I/O (pread, decrypt)
runs off the main thread.

## Integration in Plan 4

The Expo module wrapping this package will:

1. Add a Swift Package dependency to `demos/react-native/modules/offline/ios/`
   (or wherever the Expo module's Podspec lives).
2. Expose `OfflineService` methods through `expo-modules-core` `Module` API.
3. Register `OfflineSchemeHandler` on the `WKWebViewConfiguration` used by
   `react-native-webview`. This requires a small native customization since
   `react-native-webview` does not currently expose `setURLSchemeHandler`
   from JS — likely a Swift category or a wrapped native component.
4. POST `/offline/license` and download `ciphertextUrl` from JS, then call
   `OfflineService.ingestDownload` once the download completes (URLSession
   background task — Plan 4 handles the lifecycle).

## Storage layout

```
<rootDirectory>/
  catalog.sqlite            # offline_tracks table (spec § 5.6)
  blobs/<trackId>.bin       # AES-CTR ciphertext, byte-for-byte from the worker

Keychain:
  cc.musicme.offline.master.v1   # AES-256 master, hardware-backed, this-device-only
```
