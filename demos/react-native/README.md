# `@cyberscaling/secure-audio-stream-demo-rn`

Démo **React Native (Expo SDK 55)** consommant `@cyberscaling/secure-audio-stream-client` via `react-native-webview`. Reproduit l'UX du démo `webapp` — login, browse catalogue, lecture chiffrée, file dynamique — dans une coquille native. Sert de référence pour un partenaire qui veut intégrer le SDK dans une app RN sans réimplémentation native du déchiffrement.

## TL;DR

- Le SDK JS tourne dans une `<WebView>` invisible (1×1px) montée en permanence dans le composant `<PersistentPlayer />` du root layout. Audio joue, navigation native libre.
- Bridge bidirectionnel **command / event** entre le store React Native (`playerStore.tsx`) et le bundle WebView (`player-web/src/main.ts`) :
  - RN → WebView : `webview.postMessage({type:'play', at:0})` etc.
  - WebView → RN : `window.ReactNativeWebView.postMessage(...)` reçu par `WebView.onMessage`.
- Côté store, deux concepts séparés (parité avec `demos/webapp`) :
  - `state.items` — file persistée (AsyncStorage), modifiée seulement par `+`, drag-reorder, remove.
  - SDK Playlist courante (interne WebView) — peut être la file sauvée OU une liste éphémère (album "Play all", single track).
- Tab bar custom + mini-bar persistantes, toujours visibles hors login.

## Architecture

```
┌──────────────────────── RN (native shell) ────────────────────────┐
│                                                                   │
│  app/_layout.tsx  ──┐                                             │
│   ├ Stack            │  routes: home, search, library, album/:cb, │
│   │                  │          artist/:id, style/:id, player,    │
│   │                  │          queue                             │
│   ├ <PersistentPlayer/> ── always mounted (WebView 1×1px)         │
│   │     │                                                         │
│   │     └── command/event bridge ──────────────────────────┐      │
│   │                                                        │      │
│   ├ <MiniBar/>        always visible (cover/title/artist + │      │
│   │                   prev/play/next + queue button)       │      │
│   │                                                        │      │
│   └ <BottomTabBar/>   always visible (Accueil/Recherche/Library)  │
│                                                            │      │
│                                                            ▼      │
│                  ┌── WebView (WKWebView / Android WebView) ─────┐ │
│                  │  player-web bundle (assets/player.html)      │ │
│                  │    └── @cyberscaling/secure-audio-stream-    │ │
│                  │        client                                │ │
│                  │      ├ SecureAudioPlayer (MSE / MMS + AES-CTR)│ │
│                  │      └ Playlist (auto-advance + prefetch)    │ │
│                  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
                              │ HTTPS
                              ▼
                  webapp worker (Cloudflare Worker)
                              │
                              ▼
                   stream worker + R2 + crypto KV
```

Le SDK est **réellement installé** dans `player-web/package.json`. Le bundle WebView l'exécute. Aucune réimplémentation native du déchiffrement — situation exacte d'un partenaire qui héberge sa webapp dans une coquille RN.

## Bridge SDK ↔ store RN

### Côté RN — `src/lib/playerStore.tsx`

Source de vérité React Native. Owns :
- `state.items` (saved queue, persistée AsyncStorage),
- `state.mode` ∈ `'idle' | 'queue' | 'ephemeral'`,
- `state.track`, `state.playing`, `state.currentTime`, `state.duration`, `state.phase`, `state.metrics`,
- `state.currentIndex` (-1 si mode ≠ 'queue').

Expose un `dispatch(cmd)` qui broadcast à tous les subscribers. `<PersistentPlayer />` est le seul subscriber : il fait `webview.postMessage(JSON.stringify(cmd))`.

Helpers haut niveau (à appeler depuis les écrans) :
- `playSingle(track)` → SDK setItems([track]) + play, mode='ephemeral'
- `playAlbumEphemeral(tracks, startIndex)` → SDK setItems(ephemeral) + play, mode='ephemeral' (saved queue intacte)
- `playQueueAt(id?)` → SDK setItems(state.items) + play(id?), mode='queue'
- `enqueue(item)` → mute state.items + mirror SDK insert si mode='queue'
- `dequeue(id)`, `moveItem(id, pos)` → idem
- `togglePlayback()`, `next()`, `prev()`, `seek(t)`, `stop()`

### Côté WebView — `player-web/src/main.ts`

Reçoit `message` event sur `window`, parse, route vers `SecureAudioPlayer` ou `Playlist`. À chaque event SDK (`canplay`, `time`, `playlist:current-change`, `metrics`, etc.) → `window.ReactNativeWebView.postMessage(JSON.stringify(event))`.

PersistentPlayer reçoit dans `onMessage`, parse, call `player.applyPlayerEvent(event)` qui patch state.

### Lifecycle WebView

- WebView monté quand `state.track !== null` (1×1px, opacity 0, position absolute). Reste monté tant qu'un track est défini.
- Au mount, le bundle émet `{type:'ready'}` → drain des commandes en attente (pendingCmds queue).
- `playAlbumEphemeral` set `state.track` via `resetForNewTrack(firstTrack)` AVANT dispatch des commands SDK — sinon WebView jamais monté, deadlock.

## Playlist dynamique — usage RN

La classe `Playlist` du SDK gère auto-advance gapless + pré-fetch (sessions next-N + KV warmup cross-album). Côté RN tu ne l'instancies pas directement — tu utilises le bridge.

### Pattern "saved queue" (parité webapp)

```typescript
// Album page : Play all (ne touche pas la file sauvée)
<Pressable onPress={() => player.playAlbumEphemeral(refs, 0)}>
  <Text>▶ Play all</Text>
</Pressable>

// Per-track : ajout à la file persistante
<Pressable onPress={() => player.enqueue({
  ref: { cb, disc, track }, meta: { title, artist },
})}>+</Pressable>

// Queue screen : tap row → switch mode 'queue' + play at id
<Pressable onPress={() => { void player.playQueueAt(item.id); router.back() }}>...
```

### Modes

| mode | SDK playlist | state.items | UI queue affiche |
|---|---|---|---|
| `idle` | vide | conservé | state.items |
| `queue` | miroir de state.items | source de vérité | state.items |
| `ephemeral` | album ou single track | conservé (invisible côté SDK) | state.items |

À la fin d'une lecture éphémère (`event.state === 'ended'`), mode → `'idle'`. Le prochain `togglePlayback` du user re-démarre la saved queue via `playQueueAt()`.

### Pré-fetch

Le SDK Playlist pré-charge les 2 prochains tracks au niveau session (sessionId + key) et 5 au niveau KV (head Scaleway + edge cache R2). Aucun câblage RN nécessaire — c'est interne au bundle WebView. Track-to-track latency typique : ~50 ms en lecture continue.

L'écran album déclenche aussi `api.warmupAlbum(cb)` fire-and-forget au mount — pré-chauffe TOUT l'album en parallèle (cf. §Cache warm-up plus bas).

## Layout

```
demos/react-native/
  app/                        Expo Router screens (FLAT root stack)
    _layout.tsx               Stack + BottomTabBar + PersistentPlayer + HydrationBridge
    index.tsx                 auth probe → /home or /login
    login.tsx
    home.tsx                  / discovery (top + news + styles)
    search.tsx                / global search albums + artists
    library.tsx               / placeholder
    album/[cb].tsx            cover header + tracklist + Play-all + per-track +queue
    artist/[id].tsx           bio + albums + top tracks + similar
    style/[id].tsx            top albums par style
    queue.tsx                 file persistante drag-drop
    player.tsx                fullscreen (timeline + metrics + logs)
  src/
    components/
      PersistentPlayer.tsx    WebView host + MiniBar inline (2 lignes)
      BottomTabBar.tsx        tab bar custom toujours visible
      TopNav.tsx              header custom (back + user avatar)
      Cover.tsx               expo-image + placeholder
      TrackRow.tsx, AlbumCard.tsx, ArtistRow.tsx, StyleChip.tsx
    lib/
      api.ts                  fetch wrappers (cookie session)
      catalog.ts              /api/catalog/* port direct du webapp
      covers.ts               CDN URL builder (covers-ng4)
      persistence.ts          AsyncStorage wrapper
      playerStore.tsx         store + bridge dispatch
      auth.ts                 logoutAndReset()
      config.ts, types.ts, playerHtml.ts
  player-web/                 bundle WebView source
    src/main.ts               imports SDK + bridge message
    src/index.html            shell avec <script> inliné
    build.ts                  bun bundler → ../assets/player.html + ../src/lib/playerHtml.ts
  assets/
    player.html               artefact buildé (gitignored — re-généré au postinstall)
```

## Pourquoi pas de native Tabs ?

Expo Router `Tabs` cache le tab bar dès qu'on `router.push` vers un screen racine hors du groupe. Pour garder le tab bar visible partout (album, artist, queue, player, …), on a remplacé par un composant `<BottomTabBar />` rendu dans le root layout — c'est juste 3 Pressable + `router.replace('/home' | '/search' | '/library')`. La mini-bar et le tab bar coexistent en absolute positioning + safe-area inset.

## Install + run

### Pre-requisites

- **Bun 1.3+**
- **Xcode 16+** (iOS build)
- iOS simulateur **17.1+** (pour valider la voie ManagedMediaSource ; iOS antérieur fallback en mode `blob`)
- Android Studio (si build Android)
- Un **deployment webapp accessible** (cf. `demos/webapp/README.md`). C'est lui qui sert :
  - `/api/auth/login` (session cookie)
  - `/api/catalog/*` (browse)
  - `/api/jwt` (mint RS256 pour le stream worker)
  - `/api/config` (renvoie l'URL du stream worker)
  - La RN app appelle ces endpoints — pointer `EXPO_PUBLIC_WEBAPP_URL` dessus.

### 1. Configure environnement

```bash
cd demos/react-native
cp .env.example .env
```

Édite `.env` :
```dotenv
# URL du webapp déployé (cf. demos/webapp/README.md). Doit être HTTPS pour
# iOS (ATS strict).
EXPO_PUBLIC_WEBAPP_URL=https://your-webapp.workers.dev

# Optionnel: cb par défaut pour le champ saisie (legacy, écran de recherche
# global le remplace).
EXPO_PUBLIC_DEFAULT_CB=5400863209100
```

### 2. Install + build bundle WebView

```bash
bun install
```

Le `postinstall` build automatiquement le bundle WebView (`player-web/build.ts`) :
- bundle minifié de `player-web/src/main.ts` (+ SDK)
- inliné dans `assets/player.html`
- exporté comme string literal dans `src/lib/playerHtml.ts` (Metro l'embarque dans le JS bundle)

Si tu modifies `player-web/src/main.ts` ou bump le SDK, re-run `bun run build:player`.

### 3. Prebuild Expo (ios/ + android/ natifs)

```bash
bun run prebuild      # = expo prebuild --clean
```

Génère `ios/SASDemoRN.xcworkspace` + `android/` à partir d'`app.json`. CocoaPods install se fait automatiquement.

⚠️ `ios/` et `android/` sont gitignored (CNG — Continuous Native Generation) ; ils doivent être (re)générés à chaque clone et après toute modif des deps natives.

### 4. Run

```bash
bun run ios           # build + install + open simulateur iOS
# ou
bun run android       # idem Android
```

Pour build sur device physique iOS : cf. § "Configuration Xcode (signing)" plus bas.

### 5. Login + utilisation

L'app démarre sur l'écran login. Comptes de test (configurés via `DEMO_USERS` du webapp) :
- `alice:wonderland`
- `bob:builder`

Après login → tab "Accueil" : top albums + nouveautés + style chips. Tap un album → header avec cover, "Play all", tracklist.

### Reload après modif

Metro déjà lancé via `bun run ios` (script Expo). Reload :
- `r` dans le terminal Metro
- ou Cmd+R / Cmd+D dans le simulateur

Pour clean caches après changement de version SDK / babel plugin :
```bash
pkill -f 'expo start'
rm -rf /var/folders/*/T/metro-cache ~/Library/Developer/Xcode/DerivedData/SASDemoRN-* .expo
bun expo start --clear
```

## Configuration Xcode (signing)

Le scaffold cible le Team `YV33W2X58N` (Pierre Siccardi, Apple Developer Program). Pour builder sur device :

1. `bun run prebuild` génère `ios/SASDemoRN.xcworkspace`
2. Ouvre dans Xcode : `xed ios/SASDemoRN.xcworkspace`
3. Target **SASDemoRN** → **Signing & Capabilities**
   - Coche **Automatically manage signing**
   - **Team** → `Pierre Siccardi (YV33W2X58N)`
   - **Bundle Identifier** = `cc.musicme.sasdemo.rn`
4. Sélectionne ton iPhone dans la barre Xcode → ⌘R

Si l'iPhone n'est pas reconnu : `Settings → Privacy & Security → Developer Mode` (reboot). Premier lancement → `Settings → General → VPN & Device Management` → trust le certif `Apple Development: Pierre Siccardi`.

## Rebuild du bundle WebView

Quand le SDK est mis à jour ou `player-web/src/main.ts` modifié :

```bash
bun run build:player    # ou : cd player-web && bun run build
```

Le bundle est minifié, inliné dans `assets/player.html`, et exporté comme string literal dans `src/lib/playerHtml.ts` — Metro le bundle alors sans config asset particulière. HTML ~170 KB (mp4box.js dominant).

## Cache warm-up

L'écran album lance `api.warmupAlbum(cb)` fire-and-forget au mount. Pré-charge en parallèle via le stream worker `/warmup-album` :

- KV `album:<cb>` — résolution catalogue de tout l'album (cross-isolate, 24h TTL)
- KV `head:<mid>` × tracks — métadonnées Scaleway (taille + content-type)
- Cache API edge — block 0 (1 MiB) de chaque track (per-PoP, 7 jours)

Effet : premier play d'une track après warmup hit caches chauds. `play→canplay` typique passe de ~1.5s (cold) à ~400-500ms.

**Chunking transparent** : pour les albums longs, `api.warmupAlbum` fanout plusieurs invocations Worker parallèles (batch 8 tracks max) afin de rester sous la limite CF de 50 subrequests/invocation. Le champ `batches` du report indique combien ont été nécessaires.

Côté SDK partenaire prod : `prefetchAlbum(workerUrl, token, cb)` exporté par `@cyberscaling/secure-audio-stream-client` fait pareil.

## Persistance de la file

Clé AsyncStorage : `musicme:rn:playlist:v1`. Sérialise `state.items` (array de `{id, ref, meta}`). Re-hydraté au boot via `<HydrationBridge />` — items repeuplés, mode reste `'idle'`. User doit tap ⏯ sur mini-bar pour démarrer (le SDK ne s'initialise pas tant qu'aucune intention de lecture n'est exprimée — économie de mint JWT et de session worker).

Debounce 200ms sur les writes. Logout (`logoutAndReset`) appelle `persistence.remove(KEY)` + `player.stop()`.

## Limitations connues

- **iOS Safari pré-17.1** : pas de `ManagedMediaSource`, le SDK fallback automatique en `blob` (download intégral) côté WebView. Aucun changement de code intégrateur.
- **Cookies** : on s'appuie sur le cookie jar de NSURLSession / OkHttp. Pas de stockage explicite côté app. Reset = désinstaller l'app ou logout.
- **JWT TTL** : 5 min côté demo (`api.mintJwt`). Refresh transparent par le SDK quand `session_expired`.
- **Background audio** : non configuré dans ce démo. Pour le supporter, activer la background mode iOS `audio` + configurer `AVAudioSession` via un module natif Expo. Pas dans le scope du démo (qui prouve l'intégration WebView, pas la robustesse mobile complète).
- **Lock screen / Now Playing / AirPods controls** : non câblés. Nécessitent une bridge native (cf. §6.5.3 du guide partenaire pour le chemin AVPlayer).

## Voir aussi

- `client/README.md` — SDK web upstream + classes `SecureAudioPlayer` et `Playlist`
- `system-design/09-partner-integration-guide.md` §6.5 — guide partenaire, section *Plateformes non-web*
- `demos/webapp/public/playlist-store.ts` — référence du pattern saved-queue / ephemeral
- `docs/superpowers/specs/2026-05-11-rn-rich-demo-parity-design.md` — spec de la parité RN
