# `@cyberscaling/secure-audio-stream-demo-ios`

iOS native (SwiftUI) demo consuming the same Cloudflare Worker backend as
[`demos/react-native/`](../react-native/README.md), but **without WebView**.
Streaming via `AVPlayer` + `AVAssetResourceLoaderDelegate` + AES-CTR
decryption in `CommonCrypto`. Background audio, lock-screen controls
(MPNowPlayingInfoCenter / MPRemoteCommandCenter), AirPlay receiver picker.

## TL;DR

- **Two SPM packages** under `Packages/`: `SASCore` (API + Crypto + Player
  + Heartbeat + NowPlaying + Offline protocol) and `SASUI` (reusable view
  components). Both consumed by the `SASDemoiOS` app target.
- **Streaming**: AVPlayer asks the custom scheme `secured://stream/<sid>`;
  a `SecureStreamLoader` fetches encrypted ranges from `/stream/<sid>`,
  decrypts AES-256-CTR (counter = base IV + `X-Counter-Start`, big-endian),
  drops `X-Skip-Bytes` prefix, responds. AES-CTR primitive comes from
  the shared `modules/offline-core` Swift Package — no re-implementation.
- **Online v1**. Offline integrates after `feature/offline-mobile` merges,
  through the existing `OfflineStore` protocol (`NoopOfflineStore` until
  then).

## Architecture

```
SwiftUI Views
    │
    ▼
PlayerStore  (@MainActor @Observable, single source of truth)
    │  drives
    ▼
SASCore.PlaybackEngine  →  AVPlayer + AVURLAsset(scheme: secured://)
                                    + SecureStreamLoader (range delegate)
                                    + OfflineCore.AESCTRDecryptor (CommonCrypto)

SASCore.API  →  /api/auth, /api/catalog, /api/jwt, /api/config (webapp worker)
SASCore.HeartbeatTimer  →  {streamWorker}/heartbeat/<sid> every 10 s
SASCore.NowPlayingCenter  →  MPNowPlayingInfoCenter + MPRemoteCommandCenter
SASCore.OfflineStore  →  protocol; NoopOfflineStore in v1
```

## Pre-requisites

- **macOS** 14+
- **Xcode** 16+ (iOS 17.1 SDK or later)
- **xcodegen** (`brew install xcodegen`)
- iOS Simulator 17.1+ (or physical device, iOS 17.1+)
- A deployed webapp worker (see [`demos/webapp/README.md`](../webapp/README.md))
  exposing `/api/auth/login`, `/api/catalog/*`, `/api/jwt`, `/api/config`.

## Install + run

```bash
cd demos/ios-native
make project          # xcodegen → SASDemoiOS.xcodeproj
make build            # xcodebuild for iPhone 16 simulator
make test             # runs SASCoreTests
```

The Makefile destination defaults to `iPhone 16` + `OS=18.5`. Override
either variable on the command line:

```bash
make build SIMULATOR='iPhone 16 Pro' SIMULATOR_OS=18.5
```

Open in Xcode for interactive runs:

```bash
xed demos/ios-native/SASDemoiOS.xcodeproj
```

Set the `WEBAPP_URL` environment variable in the scheme (Edit Scheme → Run
→ Environment Variables) to point at your webapp worker, e.g.
`https://staging.example.workers.dev`.

Login with the demo credentials configured in the webapp worker
(`alice:wonderland`, `bob:builder` by default).

## Signing (physical device)

The project targets team `YV33W2X58N`, bundle id `cc.musicme.sasdemo.ios`.
Open Signing & Capabilities in Xcode → Team. First device run requires
trusting the developer profile (Settings → General → VPN & Device
Management).

## File layout

```
demos/ios-native/
├── Makefile                   project / build / test / clean targets
├── project.yml                XcodeGen spec
├── SASDemoiOS.xcodeproj/      generated — gitignored
├── SASDemoiOS/                app target sources
│   ├── SASDemoiOSApp.swift
│   ├── ContentView.swift
│   ├── DI/AppContainer.swift
│   ├── Persistence/QueuePersistence.swift
│   ├── Auth/AuthInterruption.swift
│   └── Views/                 SwiftUI screens
└── Packages/
    ├── SASCore/               testable; pure logic + AVPlayer host
    └── SASUI/                 SwiftUI atoms (Cover, MiniBar, …)
```

## Tests

```bash
make test
```

`SASCoreTests` covers AES-CTR (via OfflineCore link smoke), range fetch +
401 retry, JWT cache, Auth + Catalog clients, heartbeat scheduling, and
PlayerStore semantics. AVPlayer integration is not unit-tested — validated
manually per the matrix in the spec.

## Background audio + lock screen

- `Info.plist` includes `UIBackgroundModes=[audio]`.
- `AVAudioSession` is set to `.playback / .default` at launch.
- `MPRemoteCommandCenter` callbacks route to `PlayerStore.togglePlayback`,
  `.next`, `.prev`, `.seek`.
- AirPlay picker available in `PlayerView` via `AVRoutePickerView`.

## Offline (deferred)

`OfflineStore` is a protocol; v1 ships `NoopOfflineStore` (always nil).
When the iOS offline downloader integration lands in a follow-up PR, a
`FileSystemOfflineStore` (or similar) consuming `modules/offline-core` will
be wired in `AppContainer.bootPlayer()`. No PlayerStore or engine changes
required — they already consult the protocol.

## Voir aussi

- `system-design/09-partner-integration-guide.md` §6.5.3 — native iOS
  reference pattern this demo concretizes.
- `demos/react-native/README.md` — feature parity reference.
- `docs/superpowers/specs/2026-05-12-ios-native-demo-design.md` — design.
- `docs/superpowers/plans/2026-05-12-ios-native-demo.md` — this plan.
