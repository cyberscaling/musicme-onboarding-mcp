# 10 — Intégration avancée

> **Complément au guide principal.** Couvre les features optionnelles que tu actives au fur et à mesure que ton intégration mûrit : pré-chauffe cache, playlist dynamique, JWT avec date de fin d'abonnement, lecture offline chiffrée, et player natif React Native (Pattern B).

---

## 0. TL;DR

| Feature | Bénéfice | Effort | Renvoi |
|---|---|---|---|
| **Prefetch** (`prefetchAlbum` + `prefetchSession`) | Latence `play→canplay` divisée par ~3-4 (1500ms → 400ms) | 5 min | §1 |
| **Playlist dynamique** (`Playlist` SDK) | Auto-advance gapless + lookahead prefetch + mutations live | 30 min | §2 |
| **JWT `sub_exp`** | Clamp auto du TTL license offline sur la fin d'abo. 403 immédiat si expiré | 10 min côté backend partenaire | §3 |
| **Offline encrypted** | Téléchargement + lecture sans réseau. iOS / Android / RN | 1-2 jours par plateforme | §4 |
| **Player natif RN (Pattern B)** | Lock-screen + gapless + fiabilité Android. Remplace hidden WebView | 0.5-1 jour si déjà sur Pattern A | §5 |
| **Chromecast** (Web Receiver CAF custom) | Cast l'audio sécurisé vers une TV / enceinte Google Cast. Réutilise le SDK web tel quel | 1-2 jours (web) + app Cast Console | §6 |

Toutes les features se cumulent indépendamment — tu peux activer offline sans toucher au prefetch, etc.

---

## 1. Prefetch — réduire la latence

Le `play→canplay` d'une track inactive depuis longtemps tourne autour de **1.5-2s** car les caches serveur sont vides : résolution `(cb,disc,track) → mid`, `HEAD` Scaleway pour `fileSize`, premier `Range` Scaleway pour le bloc initial. Deux helpers SDK ramènent ça à **400-500ms**.

### 1.1 `prefetchAlbum` — sur mount page album

Fire-and-forget. Le worker pré-chauffe en parallèle : album KV (toutes les tracks du cb), head KV (par mid), edge cache bloc 0 (par mid).

```typescript
import { prefetchAlbum } from '@cyberscaling/secure-audio-stream-client'

useEffect(() => {
  void prefetchAlbum(STREAM_URL, token, cb).catch(() => {})  // non-fatal
}, [cb])
```

**Pas de session créée** → pas d'événement play facturé tant que l'utilisateur n'appuie pas sur play. Pour les albums longs (>8 tracks), le SDK chunke automatiquement en plusieurs invocations Worker parallèles (limite Cloudflare 50 subrequests/invocation).

### 1.2 `prefetchSession` — auto-advance gapless

Pendant la lecture de la track N (par exemple `currentTime > duration - 5s`), tu pré-crées la session N+1. Sur `ended` tu fais `player.loadPrefetched(session)`. **Zéro latence** au switch.

```typescript
import { prefetchSession } from '@cyberscaling/secure-audio-stream-client'

let nextPrepared: Promise<PrefetchedSession> | null = null

audio.addEventListener('timeupdate', () => {
  if (audio.duration - audio.currentTime < 5 && !nextPrepared) {
    nextPrepared = prefetchSession(STREAM_URL, token, nextRef)
  }
})

audio.addEventListener('ended', async () => {
  if (!nextPrepared) return
  await player.loadPrefetched(await nextPrepared)
  void player.play()
  nextPrepared = null
})
```

### 1.3 Debug — headers à consulter

- `X-Cache: HIT|MISS|PARTIAL` sur `/stream` → état du cache edge pour le bloc demandé.
- `Server-Timing: app;dur=X, jwt;dur=…, mid;dur=…, head;dur=…, do_put;dur=…` sur `/init-stream`, `/key`, `/stream` → breakdown serveur par phase.

`init_session > 300ms` en régime établi = cold isolate (Cloudflare évince après inactivité prolongée). Solutions : appel régulier sur tes pages, cron warmup sur ton top-N albums.

### 1.4 Référence vendor

Voir l'usage in-situ dans `demos/webapp/public/lib/album.ts` (vendored dans MCP repo).

---

## 2. Playlist dynamique

Pour les UX "lecture en file" (radio, suite d'album, queue partagée), le SDK expose une classe `Playlist` qui compose `SecureAudioPlayer` et gère :

- **Auto-advance** gapless sur fin de track
- **Lookahead prefetch** à deux étages : session (N+1, N+2) + KV (jusqu'à N+5)
- **Mutations live** sans interruption audio : `insert`, `move`, `remove`, `setItems`

### 2.1 Construction

```typescript
import { Playlist } from '@cyberscaling/secure-audio-stream-client'

const playlist = new Playlist({
  workerUrl: 'https://stream.musicme.cc',
  getToken: async () => (await fetch('/api/player-token', { credentials: 'include' })).json().then(j => j.token),
  audioElement: document.getElementById('player') as HTMLAudioElement,
  items: [
    { cb: 5400863209100, disc: 1, track: 1 },
    { cb: 3663729427441, disc: 1, track: 7 },
  ],
  onCurrentChange: (curr, prev) => updateNowPlayingUi(curr),
})

await playlist.play()
```

### 2.2 Lookahead — deux couches

1. **Session lookahead** = `2` (défaut). Les 2 prochaines tracks ont session + clé pré-créées via `prefetchSession`. Track-to-track ≈ 50ms.
2. **KV lookahead** = `5` (défaut). Les 5 prochaines tracks ont `mid` + `head` + edge cache pré-chauffés via `POST /warmup-tracks` (endpoint stream worker conçu pour des refs hétérogènes cross-album). Une playlist mixte se comporte comme un album in-isolate.

### 2.3 Mutations live

```typescript
playlist.insert({ cb: …, disc: 1, track: 5 }, /* position */ 1)
playlist.move(itemId, /* newPosition */ 0)
playlist.remove(itemId)
playlist.setItems([…])  // reset complet
```

### 2.4 Évènements

- `onItemsChange(items)` — fired après chaque mutation
- `onCurrentChange(curr, prev)` — fired sur `play()`, `next()`, `prev()`, auto-advance
- `onPrefetchState(e)` — `{itemId, ref, layer, state}` avec `layer ∈ {session, kv}`, `state ∈ {pending, ready, error, invalidated}` — utile pour observabilité

### 2.5 Pattern UX "playlist persistante"

Sépare deux concepts côté store applicatif :

- **`savedQueue`** : liste persistante (localStorage), modifiée seulement par `+ enqueue`, drag-reorder, remove
- **`audioPlaylist`** : l'instance `Playlist` SDK qui pilote `<audio>`. Chargée soit avec `savedQueue` (mode `'queue'`), soit avec une liste éphémère (mode `'ephemeral'` — album play-all, single track play)

Cela permet à l'utilisateur de cliquer "Play this track" sans détruire sa file en cours.

Référence : `demos/webapp/public/playlist-store.ts`.

---

## 3. JWT avec date d'expiration d'abonnement

### 3.1 Pourquoi

Sans claim explicite, le worker offline mint une license avec un TTL fixe (par défaut 30 jours, configurable côté worker via `OFFLINE_LICENSE_TTL_SECONDS`). Si l'utilisateur résilie son abonnement le jour J et que sa license expire à J+29, il peut continuer à écouter offline pendant 29 jours sans payer — **trou de revenu** + risque commercial.

La solution : ton backend ajoute un claim `sub_exp` (unix seconds) à ton JWT. Le worker offline le lit et :

- **`sub_exp > now`** : license `exp = min(now + envTtl, sub_exp)` — la license ne survit jamais à l'abonnement.
- **`sub_exp <= now`** : 403 `{error: 'subscription_expired'}` — refus immédiat, avant tout I/O.
- **Claim absent** : fallback TTL fixe (rétro-compat pour partenaires legacy).

### 3.2 Format du JWT

```json
{
  "iss": "https://partner.example.com",
  "aud": "secure-audio-stream",
  "sub": "user-42",
  "iat": 1715500000,
  "exp": 1715503600,
  "sub_exp": 1718091600
}
```

- `exp` = expiration **du JWT lui-même** (court, ~1h)
- `sub_exp` = expiration **de l'abonnement utilisateur** (longue, jusqu'à la prochaine date de renouvellement)

### 3.3 Backend — exemple Node.js

```typescript
import { SignJWT } from 'jose'

async function mintJwtForUser(userId: string, privateKey: CryptoKey): Promise<string> {
  // 1. Look up the user's subscription expiry in your billing store.
  const subExp = await db.subscriptionExpiry(userId)  // unix seconds

  // 2. Mint a short-lived JWT with sub_exp embedded.
  return await new SignJWT({
    sub: userId,
    sub_exp: subExp,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k-2026-04' })
    .setIssuer('https://partner.example.com')
    .setAudience('secure-audio-stream')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
}
```

### 3.4 Client — gestion de l'erreur

Le module RN `@demos/offline` (et plus généralement tout client qui parle au worker offline) gère le 403 `subscription_expired` via une erreur typée :

```typescript
import { downloadTrack, refreshLicense, SubscriptionExpiredError } from '@demos/offline'

try {
  await downloadTrack({ baseUrl, jwt, trackId, deviceId, metaJson })
} catch (e) {
  if (e instanceof SubscriptionExpiredError) {
    showRenewSubscriptionUi()
    return
  }
  throw e
}
```

L'auto-refresh des licenses (cf §4.4) retourne `failed[]` avec `reason: 'subscription_expired'` quand le claim est dépassé. Tu peux montrer un Alert une seule fois et arrêter de planifier d'autres refresh. Référence : `demos/react-native/app/_layout.tsx`.

### 3.5 Migration

- **Partenaire existant sans `sub_exp`** : aucun changement nécessaire — le worker tombe sur le fallback. Tu actives la feature en ajoutant le claim quand tu es prêt.
- **Pas d'abonnement (achat à vie / freemium illimité)** : ne mets pas le claim, le fallback TTL fixe s'applique.

---

## 4. Offline encrypted playback

Téléchargement chiffré + lecture sans réseau via le player natif de la plateforme.

### 4.1 Limites et trust boundary

- **Mobile only**. iOS 15+ (Swift Package), Android 24+ (Gradle library), React Native via Expo Module local. **Pas de support web** : on ne peut pas protéger une clé symétrique en JavaScript dans un navigateur, donc on ne tente pas.
- **Pas de DRM** (FairPlay / Widevine). La protection repose sur :
  1. TLS pour le transport (clé + ciphertext)
  2. JWT signé pour autoriser le mint de license
  3. Keychain (iOS) / Keystore (Android) pour le stockage local de la clé wrap
  4. Device-binding : le worker enregistre le `deviceId` au mint. Une license n'est utilisable que sur le device pour lequel elle a été émise (vérif côté worker au refresh — pas localement).
- **Modèle d'attaquant accepté** : un utilisateur rooté/jailbreaké peut extraire ses propres clés et décrypter ses propres blobs (qu'il a légitimement payés). Il **ne peut pas** récupérer les clés d'un autre utilisateur sans accès physique à son device. Suffisant pour la plupart des catalogues musique.

### 4.2 Architecture

```
┌─────────────────┐                       ┌──────────────────┐
│   App mobile    │                       │  Stream worker   │
│                 │  POST /offline/license│                  │
│  downloadTrack  │──────────────────────▶│  mint license JWT│
│                 │  Bearer <auth JWT>    │  + ciphertext URL│
│                 │◀──────────────────────│                  │
│                 │                       │                  │
│                 │  GET <ciphertextUrl>  │                  │
│                 │──────────────────────▶│  /offline/blob/  │
│                 │  Range bytes=…        │  AES-CTR encrypt │
│                 │◀──────────────────────│  ciphertext +    │
│                 │  ciphertext           │  X-Skip-Bytes    │
│                 │                       │                  │
│  OfflineModule  │                       │                  │
│  .ingest(...)   │                       └──────────────────┘
│                 │
│  ┌───────────┐  │
│  │ SQLite    │  │  catalog : trackId → (mid, deviceId, key wrapped, iv, exp)
│  │ + blob FS │  │  blobs : disque local, chiffrés AES-CTR
│  └───────────┘  │
│                 │
│  Native player  │  AVPlayer (iOS) / ExoPlayer (Android)
│  + ResourceLdr  │  → décrypte à la volée, range-aware
└─────────────────┘
```

**Flow download :**
1. App appelle `POST /offline/license` avec `{trackId, deviceId}` + Bearer JWT.
2. Worker dérive la clé AES-CTR via HKDF du master key (jamais exposée brute), signe une license JWT avec `{trackId, mid, deviceId, userId, key, iv, exp, iat, v: 'offline-v1'}`, et signe une URL `ciphertextUrl` (HMAC, courte durée).
3. App télécharge le ciphertext via `GET ciphertextUrl` (Range supporté).
4. App appelle `OfflineModule.ingestDownload({tmpPath, license, sizeBytes, metaJson})` qui :
   - Décode la license, vérifie deviceId match
   - Wrap la clé avec une clé Keychain/Keystore device-locked
   - Stocke `(trackId, blob, license, key wrap)` dans SQLite + filesystem app sandbox

**Flow playback offline :**
1. App ouvre une URL `offline://<trackId>` via AVPlayer/ExoPlayer.
2. ResourceLoader intercepte chaque `Range` request.
3. Lookup license → key (unwrap via Keychain) + iv + blob path.
4. `pread(blob, alignedRange)` puis AES-CTR decrypt → bytes plaintext au player.
5. Player joue normalement (codec décode AAC/M4A).

### 4.3 React Native — Expo Module

#### Install

Le module est vendoré comme module local dans le repo (pas de package npm public). Copie `modules/offline-core-android/`, `modules/offline-core/`, et `demos/react-native/modules/offline/` dans ton projet (chemins relatifs depuis ton app RN à `../../modules/offline-core{,-android}`).

`package.json` :
```json
{
  "dependencies": {
    "@demos/offline": "file:./modules/offline",
    "@react-native-community/netinfo": "^12.0.0",
    "expo-file-system": "^55.0.0"
  }
}
```

`android/settings.gradle` (snippet — ajouter avant ou après `include ':app'`) :
```gradle
include ':offline-core-android'
project(':offline-core-android').projectDir = new File(rootProject.projectDir, '../../../modules/offline-core-android')
```

Puis `expo prebuild` + `expo run:ios` / `run:android` pour autolink le module natif.

#### Player natif — `NativePlayer` + `Player` singleton

Le module expose deux surfaces principales pour la lecture :

- **`Player` singleton** — gère le token cache, le worker URL, et le prefetch gapless.
- **`NativePlayer`** — composant vue Expo (1×1 caché) qui wrape AVPlayer (iOS) ou ExoPlayer (Android). Il reçoit la ref de track et déclenche le bootstrap automatiquement.

**Setup au démarrage de l'app :**

```typescript
import { Player } from '@demos/offline'

// À appeler une seule fois, typiquement dans _layout.tsx ou App.tsx.
// tokenProvider est un callback qui retourne un JWT frais (le Player
// le rafraîchit automatiquement toutes les 4 minutes).
Player.configure({
  baseUrl: 'https://stream.musicme.cc',
  tokenProvider: async () => {
    const { token } = await fetch('/api/player-token', { method: 'POST', credentials: 'include' }).then(r => r.json())
    return token
  },
})
```

**Composant de lecture :**

```typescript
import { NativePlayer } from '@demos/offline'
import type { PlayMetricsReport } from '@demos/offline'

<NativePlayer
  trackRef={{ cb: 5400863209100, disc: 1, track: 3 }}
  playing={isPlaying}
  seekToMs={seekPosition}        // null = pas de seek en cours
  title="Fête foraine"
  artist="Christophe Maé"
  coverUrl="https://example.com/cover.jpg"
  onReady={() => setDuration(…)}
  onTimeUpdate={(e) => setPosition(e.nativeEvent.positionMs)}
  onEnded={() => playNext()}
  onError={(e) => console.error(e.nativeEvent.message)}
  onMetrics={(report: PlayMetricsReport) => sendAnalytics(report)}
/>
```

`NativePlayer` se monte une fois au root layout (ou au niveau `PersistentPlayer`) et reste monté en permanence. Le changement de `trackRef` déclenche un nouveau chargement. Le composant gère l'intégration lock-screen automatiquement (Now Playing iOS + seek bar + AirPods controls, MediaSession + foreground service + AudioFocus Android) dès `load()`.

**Schéma `PlayMetricsReport` — émis par `onMetrics` en fin de track ou d'abandon :**

```typescript
interface PlayMetricsReport {
  bootstrapMs: number       // POST /init-stream → réponse (inclut résolution mid + key + iv)
  firstKeyMs: number        // toujours 0 (la clé arrive avec le bootstrap, pas de /key séparé)
  firstRangeMs: number      // premier GET /stream/<sid> → premier byte décrypté
  firstCanplayMs: number    // bootstrap + premier range décrypté → player ready
  totalPlayMs: number       // durée de lecture effective (hors pauses)
  bufferUnderruns: number   // nombre d'interruptions buffer pendant la lecture
  sessionRotations: number  // nombre de re-bootstraps (session 410 récupérée)
  fileSizeBytes: number     // taille totale du fichier (audio compressé)
  outcome: 'completed' | 'aborted' | 'error'
}
```

**Prefetch gapless — `Player.prefetch(ref)` :**

Appelle `Player.prefetch(ref)` quand la position courante passe sous `duration - 5s`. Le Player pré-bootstrappe la session suivante et lit les premiers 256 KB ; quand `NativePlayer.load()` est appelé pour la track suivante, il consomme la session pré-fetchée depuis le `PrefetchCache` (Swift + Kotlin) plutôt que de re-bootstrapper.

```typescript
// Côté PersistentPlayer (ou useEffect sur timeupdate) :
if (duration > 0 && position >= duration - 5000 && nextRef) {
  void Player.prefetch(nextRef).catch(() => {})  // non-fatal
}
```

#### API publique — téléchargement offline et gestion catalog

```typescript
import {
  OfflineModule,
  downloadTrack,
  refreshLicense,
  refreshExpiringLicenses,
  SubscriptionExpiredError,
} from '@demos/offline'

// Download
await downloadTrack({
  baseUrl: 'https://stream.musicme.cc',
  jwt: '<auth JWT>',
  deviceId: await OfflineModule.getDeviceId(),
  trackId: '5400863209100:1:3',
  metaJson: JSON.stringify({ title: 'Fête foraine', artist: 'Christophe Maé', duration: 204 }),
})

// List + remove
const tracks = await OfflineModule.listTracks()
await OfflineModule.removeTrack('5400863209100:1:3')

// Wipe all (à appeler sur logout)
await OfflineModule.wipeAll()
```

**`OfflineService.openSource(ref, workerUrl, tokenProvider)`** est le point d'entrée unique côté natif (Swift / Kotlin) : retourne un `BlobSource` si la track est dans le catalogue offline local, sinon un `StreamSource` (qui wrape une `StreamSession`). `NativePlayer` et `SasPlayerResourceLoader` / `SasPlayerDataSource` consomment ce `ByteSource` de façon transparente — le code applicatif n'a pas à distinguer online/offline.

#### Auto-refresh des licenses

Au foreground avec réseau, lance `refreshExpiringLicenses` pour renouveler les licenses qui arrivent à expiration (par défaut, fenêtre de 7 jours). Référence : `demos/react-native/app/_layout.tsx`.

```typescript
import { useEffect, useRef } from 'react'
import { Alert, AppState } from 'react-native'
import { OfflineModule, refreshExpiringLicenses } from '@demos/offline'

function useOfflineAutoRefresh() {
  const subExpiredAlerted = useRef(false)
  useEffect(() => {
    async function tick() {
      try {
        const { token } = await yourBackend.mintJwt()
        const deviceId = await OfflineModule.getDeviceId()
        const { failed } = await refreshExpiringLicenses({
          baseUrl: STREAM_URL,
          jwt: token,
          deviceId,
        })
        if (failed.some(f => f.reason === 'subscription_expired') && !subExpiredAlerted.current) {
          subExpiredAlerted.current = true
          Alert.alert('Subscription expired', 'Renouvelle ton abonnement pour rafraîchir les licenses.')
        }
      } catch { /* best-effort */ }
    }
    void tick()
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void tick() })
    return () => sub.remove()
  }, [])
}
```

#### Logout = wipeAll

Sur shared device, le user qui se déconnecte ne doit pas laisser ses downloads accessibles au compte suivant.

```typescript
export async function logoutAndReset(stopPlayer: () => void) {
  await yourBackend.logout()
  stopPlayer()
  try { await OfflineModule.wipeAll() } catch { /* native module absent → ignore */ }
  router.replace('/login')
}
```

### 4.4 iOS natif — Swift Package

Le package `OfflineCore` (Swift Package Manager, iOS 15+) expose la même API conceptuelle que le module RN.

`Package.swift` consumer :
```swift
dependencies: [
    .package(path: "../../modules/offline-core"),
],
targets: [
    .target(name: "MyApp", dependencies: ["OfflineCore"]),
]
```

Usage :
```swift
import OfflineCore

let service = try OfflineService(
    baseDirectory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0],
    deviceIdProvider: { /* persistent id from Keychain */ }
)

// Ingest a downloaded blob + license
try service.ingestDownload(
    tmpPath: tmpFileURL.path,
    license: licenseJWT,
    sizeBytes: 5_242_880,
    meta: ["title": "Fête foraine"]
)

// List
let tracks = service.listTracks()

// Open a stream for AVPlayer
let resourceLoader = OfflineSchemeHandler(
    service: service,
    deviceIdProvider: { keychainDeviceId() }
)
let asset = AVURLAsset(url: URL(string: "offline://5400863209100:1:3")!)
asset.resourceLoader.setDelegate(resourceLoader, queue: .main)
let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
```

Référence complète : `demos/ios-native/` (vendoré dans MCP repo).

### 4.5 Android natif — Gradle library

Le module `offline-core-android` (Gradle library, minSdk 24).

`settings.gradle.kts` consumer :
```kotlin
include(":offline-core-android")
project(":offline-core-android").projectDir = File(rootProject.projectDir, "../modules/offline-core-android")
```

`app/build.gradle.kts` :
```kotlin
dependencies {
    implementation(project(":offline-core-android"))
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-datasource:1.4.1")
}
```

Usage (Kotlin) :
```kotlin
val service = OfflineService(
    context = applicationContext,
    deviceIdProvider = { getDeviceIdFromKeystore() }
)

// Ingest
service.ingestDownload(
    tmpPath = tmpFile.absolutePath,
    license = licenseJWT,
    sizeBytes = 5_242_880,
    meta = mapOf("title" to "Fête foraine")
)

// ExoPlayer playback via custom DataSource
val dataSourceFactory = OfflineAssetDataSource.Factory(service)
val mediaSource = ProgressiveMediaSource.Factory(dataSourceFactory)
    .createMediaSource(MediaItem.fromUri("offline-asset://5400863209100:1:3/audio.m4a"))
val player = ExoPlayer.Builder(applicationContext).build()
player.setMediaSource(mediaSource)
player.prepare()
player.play()
```

### 4.6 License lifecycle

| Évènement | TTL appliqué | Comportement |
|---|---|---|
| Premier download | `min(now + envTtl, sub_exp ou ∞)` | Track jouable jusqu'à `license.exp` |
| Foreground app + online + license `< 7d` de l'expiration | License refresh demandé | `min(now + envTtl, sub_exp ou ∞)` recalculé |
| License expirée avant refresh | Refus côté native player | UI doit afficher "Renew subscription" ou "Reconnect to refresh" |
| `sub_exp <= now` au refresh | 403 `subscription_expired` | `SubscriptionExpiredError` levée → UI |
| Logout | `wipeAll()` | Toutes les licenses + blobs supprimés |

### 4.7 Sécurité — règles à ne pas casser

1. **Ne jamais logger les clés** (ni master, ni track key déwrappée). Les outils crash reporters (Sentry, Crashlytics) doivent être configurés pour scrub les champs `key`, `iv`, `license`.
2. **Master offline key** vit dans le secret manager du worker (Cloudflare Workers Secrets, env-encrypted). Ne jamais commiter, ne jamais vendor dans le binaire app.
3. **TLS obligatoire** entre app et worker. Pour les partenaires haut-risque, certificate pinning recommandé (NSAppTransportSecurity sur iOS, Network Security Config sur Android).
4. **Pas de bypass JWT.** Le worker valide RS256 signature + `iss` + `aud` + `exp` côté worker. Aucun chemin "trust the client".
5. **DeviceId binding.** Le `deviceId` envoyé au mint license vient du Keychain/Keystore device-locked. **Ne pas** le baser sur `UserDefaults` / `SharedPreferences` non-encrypted, ni sur `UIDevice.identifierForVendor` (portable inter-app via iCloud backup).
6. **Logout** = `wipeAll()` même si l'appel `/api/auth/logout` réseau échoue. Best-effort, mais local always.

### 4.8 Référence vendor

Implémentation de référence vivante dans le repo public :
- `modules/offline-core/` — Swift Package iOS
- `modules/offline-core-android/` — Gradle library Android
- `demos/react-native/modules/offline/` — Expo Module wrapper
- `demos/react-native/app/_layout.tsx` — auto-refresh + Alert sub_exp
- `demos/react-native/src/components/DownloadButton.tsx` — UI bouton DL
- `demos/react-native/app/downloads.tsx` — écran liste + suppression
- `demos/ios-native/Packages/SASCore/Sources/SASCore/Offline/` — abstraction Swift native demo

---

## 5. Migration depuis le chemin WebView (RN uniquement)

Cette section s'adresse aux partenaires React Native qui utilisaient l'ancien chemin **Pattern A** (hidden WebView + SDK `@cyberscaling/secure-audio-stream-client` + `react-native-webview` + bundle `player-web/`). Le SDK web reste **inchangé** pour les intégrations web (aucune action requise pour les partenaires web).

### 5.1 Comparatif — Pattern A vs Pattern B

| Critère | Pattern A — WebView (legacy) | Pattern B — Natif (recommandé) |
|---|---|---|
| Effort d'intégration | Faible — pas de code natif | Moyen — vendor le module Expo + `expo prebuild` |
| Dépendances RN | `react-native-webview` + `@cyberscaling/secure-audio-stream-client` | `@demos/offline` (vendoré) + modules natifs |
| Lock-screen (Now Playing, AirPods, seek bar) | Nécessite un bridge JS→native custom | Intégré automatiquement (`NowPlayingCenter` iOS, `MediaSession` Android) |
| Lecture en arrière-plan | `UIBackgroundModes=audio` requis + instable sous pression mémoire | Stable — AVPlayer / ExoPlayer avec foreground service Android |
| Gapless prefetch | Non supporté | `Player.prefetch(ref)` — zéro latence au switch |
| Fiabilité Android | Processus Chromium sandboxé peut être évincé (OOM killer) | Pas de processus Chromium — ExoPlayer natif |
| Métriques | Non disponibles | `PlayMetricsReport` complet via `onMetrics` |

Le Pattern A reste documenté et supporté. Pattern B est le chemin utilisé par l'app de démo de référence `demos/react-native/`.

### 5.2 Ce qu'on supprime lors de la migration A → B

- Dépendance npm `react-native-webview` (à retirer du `package.json`).
- Dépendance npm `@cyberscaling/secure-audio-stream-client` (pour RN uniquement — la garder si l'app a aussi une surface web).
- Bundle `player-web/` et l'asset `assets/player.html` (supprimés du repo).
- Le composant `<WebView>` monté en hidden 1×1 au root layout.
- Le bridge de message-passing (commandes/events `configure`, `play`, `pause`, `seek`, etc.).

### 5.3 Ce qu'on ajoute

1. Vendor `modules/offline-core/` + `modules/offline-core-android/` + `demos/react-native/modules/offline/` depuis le repo MCP.
2. `Player.configure({ baseUrl, tokenProvider })` au boot de l'app.
3. Composant `<NativePlayer trackRef={…} playing={…} seekToMs={…} title artist coverUrl onMetrics … />` à la place du `<WebView>` caché.
4. `Player.prefetch(ref)` sur l'événement `timeupdate` (position > duration - 5s).
5. `UIBackgroundModes: ['audio']` dans `app.json > ios.infoPlist` (déjà requis pour le Pattern A, mais maintenant géré proprement par le foreground service).

### 5.4 Continuité — Pattern A toujours supporté

Si tu ne veux pas faire la migration maintenant : **rien à changer**. Le chemin WebView continue de fonctionner. Les limitations documentées (Android process eviction, absence de gapless, lock-screen sans bridge custom) restent présentes, mais elles n'empirent pas. Migre vers Pattern B quand ces limitations deviennent bloquantes pour ton UX.

---

## 6. Chromecast — cast vers une TV / enceinte

Diffuser l'audio sécurisé sur un appareil Google Cast (Chromecast, Android TV,
enceinte Nest, TV avec Chromecast intégré) via un **Web Receiver CAF custom**.

### 6.1 Principe — pourquoi ça marche sans toucher au serveur

Un Chromecast est un environnement Chrome. Le **même SDK web**
`@cyberscaling/secure-audio-stream-client` (MSE + déchiffrement AES-CTR WebCrypto)
tourne donc **tel quel** dans une page receiver hébergée sur ton site. Le receiver
crée **sa propre** session `/init-stream` (sa clé, son empreinte IP+UA cohérente
sur l'appareil cast) → le binding de session (§8 du guide principal) reste intact.
**Zéro changement worker, zéro changement SDK.**

Le cast « natif » (RemotePlayback / mirroring du tag `<audio>`) est volontairement
désactivé : le receiver n'aurait pas la clé. C'est le receiver custom qui déchiffre.

### 6.2 Les pièces

| Pièce | Rôle |
|---|---|
| Page receiver (`cast.html` + bootstrap CAF) | Hébergée HTTPS sur ton site. Charge le framework CAF + ton receiver. |
| `ReceiverController` | Enveloppe le `Playlist` SDK. Consomme les messages du sender, joue, renvoie le STATUS. |
| Sender (bouton cast dans ton UI) | API Cast Web Sender (Chrome). Découvre l'appareil, lance le receiver, relaie un JWT + la file. |
| Canal de messages custom | namespace `urn:x-cast:<ton-app>`. Messages JSON (cf. 6.4). |

Code de référence complet : `demos/webapp/public/cast/` (receiver + protocole),
`demos/webapp/public/cast-sender.ts` (sender), câblé dans la mini-barre
`demos/webapp/public/components/mini-bar.ts`.

### 6.3 Activer le cast — étapes partenaire

1. **Enregistrer une app Custom Receiver** sur la [Google Cast SDK Developer Console](https://cast.google.com/publish) (compte Google, frais dev uniques). Receiver URL = ta page cast hébergée (ex. `https://ton-site/cast`). Tu obtiens un **Application ID** (8 hex).
2. **Renseigner l'App ID** dans ta config (dans la démo : `CAST_APP_ID`, exposé au SPA via `/api/config`). Vide ⇒ bouton cast caché.
3. **Dev** : enregistrer le **numéro de série** de l'appareil de test (onglet Devices) puis rebooter l'appareil. **Prod** : **publier** l'app receiver → tous les appareils Cast la lancent sans enregistrement.
4. Le bouton cast apparaît dans ton lecteur → l'utilisateur sélectionne l'appareil → l'audio part sur la TV.

⚠️ Cast = découverte **réseau local** (mDNS) : navigateur sender et appareil sur le **même Wi-Fi**. Navigateur **Chromium** requis (Chrome/Edge desktop, Chrome Android — pas Safari/Firefox).

### 6.4 Protocole du canal

- **Sender → receiver** : `LOAD` (token + items de file + `startId`/`positionSec`/`autoplay` optionnels), `PLAY`, `PAUSE`, `NEXT`, `PREV`, `SEEK`, `SET_TOKEN`, `STOP`.
- **Receiver → sender** : `STATUS` (state/itemId/index/currentTime/duration/meta) et `ERROR`.

Un seul `LOAD` « intelligent » gère tout : si `startId` == la piste en cours, le
receiver **reconcilie** la file en place (édition de file sans redémarrage) ;
sinon il charge la piste. `autoplay` reflète l'état de lecture (`false` = charge en pause).
Le token JWT est rafraîchi périodiquement via `SET_TOKEN` (lecture longue).

### 6.5 Lecture transparente une fois connecté

Une fois connecté, **toutes** les intentions de lecture (clic sur une piste,
play-album, saut dans la file, édition de file, next/prev/play-pause) sont routées
vers le receiver — le lecteur local est mis en veille. À la connexion, la piste en
cours + sa position partent sur l'appareil et **la lecture démarre automatiquement** ;
à la déconnexion, la lecture reprend **en local à la même position** (en pause).
Côté implémentation, tout transite par un point unique (le store de playlist) qui
route vers le cast quand connecté — pas de logique cast éparpillée dans l'UI.

### 6.6 Appareils contraints

Les Chromecast / clés Android TV ont peu de mémoire : le SDK gère une **fenêtre
glissante MSE** (backpressure + éviction du déjà-joué sur `QuotaExceededError`) et
la session `/init-stream` voit son `exp` prolongé à chaque heartbeat — une piste
longue sur un appareil contraint ne coupe donc pas. Rien à faire côté partenaire,
c'est dans le SDK / le worker.

### 6.7 Effort & deferred

- **Effort** : ~1-2 j (page receiver + sender web) + enregistrement Cast Console (trivial).
- **Deferred** : sender React Native (`react-native-google-cast`, rebuild natif) ; AirPlay (iOS — mécanisme distinct, lecture native re-streamée, pas de receiver custom possible).

---

## 7. Quotas et coûts spécifiques aux features avancées

| Évènement | Compté comme play ? | Bandwidth | Notes |
|---|---|---|---|
| `prefetchAlbum` | Non | KV + edge cache writes | Pas d'event facturé, juste warm-up |
| `prefetchSession` | Non | Session DO PUT | Compté à la première lecture réelle |
| `Player.prefetch(ref)` (RN natif) | Non | Bootstrap + premier 256 KB range | Compte à la première lecture réelle (même sémantique que `prefetchSession`) |
| `Playlist` track auto-advance | Oui (1 play / track joué) | Stream | Identique à un play manuel |
| `downloadTrack` | Oui (1 play / ingest) | Ciphertext download | Compte au moment du download |
| `refreshLicense` | Non | JWT round-trip | Gratuit |
| Playback offline | Non | Lecture locale | Aucun trafic réseau |
| Playback cast (receiver) | Oui (1 play / track) | Stream | Le receiver crée sa propre session `/init-stream` — compté comme un play normal |

Ciphertext = `1.01x` du plaintext (overhead négligeable, ~16 bytes par AES block + headers).

---

## 8. Checklist d'activation par feature

- [ ] **Prefetch web** : `prefetchAlbum` au mount page album. `prefetchSession` sur `timeupdate` quand `currentTime > duration - 5s`.
- [ ] **Playlist dynamique** : remplacer le câblage `<audio>` ad-hoc par `Playlist` SDK. Câbler `onCurrentChange` pour ton UI now-playing.
- [ ] **`sub_exp`** : ajouter le claim au mint JWT (snippet §3.3). Tester côté client : forcer `sub_exp = now - 1` → confirmer `SubscriptionExpiredError` levée + UI Alert.
- [ ] **Offline iOS** : ajouter `OfflineCore` au `Package.swift`. Implémenter UI download + intégration AVPlayer via `OfflineSchemeHandler`.
- [ ] **Offline Android** : ajouter `offline-core-android` au `settings.gradle`. Implémenter UI download + ExoPlayer `OfflineAssetDataSource`.
- [ ] **Offline RN** : `bun install` après vendor du module. `expo prebuild` puis `expo run:ios` / `run:android`. Wire `useOfflineAutoRefresh` au root layout. Wire `wipeAll` dans logout.
- [ ] **Player natif RN (Pattern B)** : `Player.configure({ baseUrl, tokenProvider })` au boot. Remplacer `<WebView>` caché + bridge par `<NativePlayer>`. Câbler `Player.prefetch(ref)` sur `timeupdate`. Câbler `onMetrics` pour analytics.
- [ ] **Tests sécurité offline** : confirmer (a) logout vide bien les downloads, (b) deviceId stable across reinstall, (c) license expire ne crashe pas le player.
- [ ] **Chromecast** : enregistrer (puis publier) l'app Custom Receiver sur la Cast Console, héberger la page receiver en HTTPS, renseigner `CAST_APP_ID`, câbler le bouton cast au sender. Tester sur appareil réel (même Wi-Fi, navigateur Chromium).

---

## 9. Renvois

- Guide d'intégration principal : `docs/integration-guide.md`
- API de référence SDK web : `@cyberscaling/secure-audio-stream-client` (npm) — inchangé pour les intégrations web
- Architecture worker offline : `worker/src/routes/offline.ts` (vendoré dans MCP repo `modules/`)
- Spec design offline : `docs/superpowers/specs/2026-05-12-mobile-offline-encrypted-design.md` (source repo)
- Démo de référence RN (Pattern B natif) : `demos/react-native/` (vendoré dans MCP repo)
