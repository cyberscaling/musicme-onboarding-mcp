# offline-core-android

Standalone Android Gradle library providing Android-side primitives for the
encrypted offline audio playback feature.

## Status

Plan 3 of 4 (`docs/superpowers/plans/2026-05-12-offline-android-core.md`).
This library is pure Kotlin Android — no React Native or Expo dependency.
Plan 4 will wrap it as an Expo module and wire `OfflinePathHandler` into
the WebView used by the RN demo's `PersistentPlayer.tsx`.

Mirrors the iOS counterpart at `modules/offline-core/` byte-for-byte where
the platform APIs allow.

## Public surface

```kotlin
import cc.musicme.offline.*
import java.io.File

// One per app instance.
val service = OfflineService(
    context = applicationContext,
    rootDirectory = File(applicationContext.filesDir, "offline")
    // keyVault defaults to AndroidKeyStoreKeyVault — hardware-backed when available.
)

// After fetching {license, ciphertextUrl, sizeBytes} from /offline/license,
// and after downloading ciphertextUrl to a temp file:
service.ingestDownload(
    tmpFile = downloadedFile,
    license = licenseJwt,
    sizeBytes = sizeBytesFromResponse,
    metaJson = optionalMetaJsonString
)

val rows = service.listTracks()
val exists = service.hasTrack("5400863209100:1:1")
service.removeTrack("5400863209100:1:1")
service.wipeAll()

// Wire into WebView (Plan 4 will do this):
val handler = service.makePathHandler(deviceIdProvider = { currentDeviceId() })
val loader = WebViewAssetLoader.Builder()
    .setDomain(OfflinePathHandler.DOMAIN)
    .addPathHandler(OfflinePathHandler.PATH_PREFIX, handler)
    .build()
// And a custom WebViewClient that forwards Range headers — see caveat below.
// Player JS uses `https://offline.musicme.local/offline/<trackId>/audio.m4a`.
```

## KeyVault — interface + two implementations

The plan's pseudo-code instantiated a concrete `KeyVault(alias)`. Plan 3
refactored to:

- `KeyVault` — interface with `wrap(key)`, `unwrap(ct, nonce)`,
  `deleteMasterKey()`.
- `AndroidKeyStoreKeyVault` — production implementation backed by
  `AndroidKeyStore`. Hardware-backed on devices with Secure Enclave / StrongBox.
  Not exercised by Robolectric unit tests (the AndroidKeyStore provider is not
  registered on the JVM). Plan 4 adds instrumented tests on emulator/device.
- `InMemoryKeyVault` — process-local fake used by every unit test in this
  module. Identical semantics for the wrap/unwrap contract.

`OfflineService`'s constructor accepts a `KeyVault` parameter, defaulting to
`AndroidKeyStoreKeyVault()` — so production callers don't need to know about
the split.

## Range header caveat

`WebViewAssetLoader.PathHandler.handle(path: String)` does NOT receive the
HTTP Range header. To support seeking in MSE-based players, Plan 4 must
intercept `shouldInterceptRequest(WebView, WebResourceRequest)` on a custom
`WebViewClient` and call `OfflinePathHandler.handle(trackId, rangeHeader)`
directly, bypassing the asset loader's prefix routing.

The default `PathHandler.handle(path)` path remains correct for non-Range
full-file playback (returns 200 with the entire file).

## Trust model

- License JWT signature is NOT verified on-device. The worker is the trust
  boundary; TLS protects the JWT in transit.
- AndroidKeyStore-backed master key (hardware-backed when StrongBox or TEE
  available). Wrapping uses AES-256-GCM.
- The path handler enforces, in order: catalog hit → 404 if missing;
  `deviceId` match → 403 + row deletion if not; `license_exp` not in the
  past → 410 if expired; KeyVault unwrap → 410 if master key wiped/rotated.

## Testing

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH=$JAVA_HOME/bin:$PATH
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd modules/offline-core-android
./gradlew testDebugUnitTest
```

Runs on the JVM with Robolectric (no emulator required). The current suite
has 30 tests covering license decoding, AES-CTR counter math, in-memory
KeyVault wrap/unwrap, SQLite CRUD, file IO + pread, path handler status
codes and Range alignment, downloader rollback, and the service facade
end-to-end.

`AndroidKeyStoreKeyVault` is the only file NOT covered by unit tests — Plan
4's instrumented tests will exercise it on a real emulator.

## Storage layout

```
<rootDirectory>/
  catalog.sqlite                  # offline_tracks table (spec § 5.6)
  blobs/<sanitized-trackId>.bin   # AES-CTR ciphertext, byte-for-byte from the worker

AndroidKeyStore:
  cc.musicme.offline.master.v1   # AES-256 master, hardware-backed when possible
```

`trackId` characters `:` and `/` are replaced with `_` in the filename to
sidestep tooling that mishandles them; the SQLite `track_id` column keeps
the original `cb:disc:track` format.

## Integration in Plan 4

The Expo module wrapping this library will:

1. Include this library as a Gradle dependency in the Expo module's
   `android/build.gradle`.
2. Expose `OfflineService` methods through `expo-modules-core` `Module` API.
3. Register `OfflinePathHandler` via a custom `WebViewClient`'s
   `shouldInterceptRequest` (the AssetLoader's built-in interception does
   NOT pass Range headers — see caveat above).
4. POST `/offline/license` and download `ciphertextUrl` from JS, then call
   `OfflineService.ingestDownload` once the download completes (WorkManager
   handles background download lifecycle — Plan 4 will wire it).
