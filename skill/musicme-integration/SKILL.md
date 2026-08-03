---
name: musicme-integration
description: Guide d'intégration du streaming audio musicme dans un site existant. Active ce skill quand l'utilisateur veut intégrer la techno musicme, ou parle de "secure-audio-stream", "/init-stream", "MINT_KEY", "JWT mint", ou colle l'un des prompts du jeu d'intégration musicme.
triggers:
  - "intégrer musicme"
  - "musicme integration"
  - "secure-audio-stream"
  - "ajouter le player musicme"
  - "MINT_KEY"
  - "/musicme-integration"
---

# Skill — musicme-integration

Tu es un agent qui aide un développeur **non-spécialiste** à intégrer
la techno de streaming audio musicme dans un site existant. La techno
fournit un lecteur sécurisé qui joue de la musique chiffrée
end-to-end, avec auth JWT côté backend.

> Références canoniques :
> - **Intégration de base** : <https://github.com/cyberscaling/musicme-onboarding-mcp/blob/main/docs/integration-guide.md> (signature JWT, MSE/Blob, troubleshooting CORS, etc.)
> - **Features avancées** : <https://github.com/cyberscaling/musicme-onboarding-mcp/blob/main/docs/advanced-integration.md> (offline crypté mobile, prefetch, playlist dynamique, JWT `sub_exp`, Chromecast)
>
> Y renvoyer l'utilisateur quand un détail mérite lecture approfondie.

Cette skill s'active automatiquement quand l'utilisateur:
- demande l'intégration musicme,
- colle l'un des 6 prompts du jeu d'intégration (`prompts/integration-prompts.md`),
- bloque sur un message d'erreur du flow musicme (voir Troubleshooting).

---

## Mode de réponse — `stream-mode`

Pendant cette skill, réponds en **stream-mode**, terse et structuré.
Règles:

- Drop articles (le/la/les), filler (just, really, basically), pleasantries (sure, of course).
- Fragments OK. Phrases courtes.
- Code blocks: **inchangés** (style natif du projet).
- Errors: cite la chaîne exacte ("status: foo_bar").
- Tableaux markdown pour décisions / status.
- Checkmarks `✓ / ✗ / ↷` (skip) pour statut.
- 1 sentence per concept max.
- Si l'utilisateur dit "stop caveman" ou "normal mode" → revenir au style standard.

Ne pas activer en hors-flow (e.g. l'utilisateur demande une explication
hors-musicme pendant la skill — répondre au point puis revenir au flow).

---

## Cheminement (les 6 phases)

```
1. AUDIT          ─► état des lieux du repo cible (lecture seule)
2. CLARIFY        ─► questions humain UNIQUEMENT si l'audit n'a pas tranché
3. SPECS          ─► work items + dépendances + sous-agents parallélisables
4. PLANNING       ─► tests à valider autonomément pendant impl
5. IMPLEMENTATION ─► code + tests verts à chaque WI, smoke E2E final
6. FINAL DOCS     ─► runbook + plan de tests à dérouler par humain
```

Chaque phase a un **prompt** dédié dans `prompts/integration-prompts.md`.
L'utilisateur colle le prompt; tu exécutes; tu rends la main pour le suivant.

### Principe directeur

- Toujours partir d'un audit avant d'écrire du code.
- Pas de question à l'utilisateur si l'audit a tranché.
- Maxi parallélisme via sous-agents quand les WI sont indépendants.
- Test à chaque WI (pas tests à la fin).
- Smoke E2E final = passe ou échoue tout, c'est la porte de sortie.

### Pré-requis côté utilisateur

- MCP `musicme-onboarding` configuré (voir `README.md` du repo MCP).
- `MUSICME_ONBOARDING_API_KEY` reçue de l'opérateur musicme et stockée
  dans la config du client MCP.

Si l'un manque, le flow démarre par "configure le MCP avant la phase 1".

---

## Connaissance technique embarquée

Tu dois connaître par cœur ces faits pour ne pas surcharger le contexte:

### URLs canoniques

| Rôle | URL |
|---|---|
| Stream worker | `https://secure-stream.musicme.com` |
| Admin worker | `https://admin-stream.musicme.cc` |
| Demo (test) | `https://demo-stream.musicme.cc` |

### Endpoints clés

| Endpoint | Méthode | Auth | Usage |
|---|---|---|---|
| `/api/onboarding/partners` | POST | `X-Onboarding-Key` | register partner (one-shot) |
| `/api/onboarding/partners/<id>` | GET | `X-Onboarding-Key` | status |
| `/api/onboarding/partners/<id>` | PATCH | `X-Onboarding-Key` | update allowed_origins |
| `/api/internal/mint/<id>` | POST | `X-Mint-Key` | mint JWT pour user (côté backend partenaire) |
| `/init-stream` | POST | `Authorization: Bearer <JWT>` | open session |
| `/stream/<sid>` | GET | (session) | ciphertext AES-CTR |
| `/key/<sid>` | GET | (session) | clé AES (32B) + IV (16B) |
| `/heartbeat/<sid>` | POST | (session) | progression session |
| `/warmup-album` | POST | `Authorization: Bearer <JWT>` | pré-chauffe cache album (prefetch) |
| `/warmup-tracks` | POST | `Authorization: Bearer <JWT>` | pré-chauffe refs hétérogènes (playlist lookahead) |
| `/offline/license` | POST | `Authorization: Bearer <JWT>` | mint license offline + ciphertextUrl |
| `/offline/license-refresh` | POST | `Authorization: Bearer <JWT>` | renouveler license offline existante |
| `/offline/blob/:trackId` | GET | URL signée (sig + exp + deviceId) | ciphertext téléchargeable, Range supporté |

### JWT minté

```json
{
  "alg": "RS256",
  "kid": "key_..."
}
.
{
  "iss": "https://admin-stream.musicme.cc",
  "sub": "<user-id-fourni-par-le-partenaire>",
  "aud": "secure-audio-stream",
  "iat": ...,
  "exp": ...,
  "sub_exp": ...
}
```

TTL par défaut 300s. Pas de session côté JWT — la session est créée par
`/init-stream`.

**Claim `sub_exp` (optionnel)** — date de fin d'abonnement utilisateur
(unix seconds). Si présent, le worker clampe le TTL des licenses offline
sur cette date (`exp = min(now + envTtl, sub_exp)`) et refuse 403
`subscription_expired` si dépassé. Absent → fallback TTL fixe
(rétro-compat). À fournir UNIQUEMENT si le partenaire utilise la feature
offline et veut couper l'accès offline en cas de résiliation.

### SDK frontend

Package npm public : `@cyberscaling/secure-audio-stream-client`. Install :
`bun add @cyberscaling/secure-audio-stream-client` (ou pnpm/npm/yarn).
Classe principale :
`SecureAudioPlayer({ workerUrl, getToken, mode, onError, onProgress, metrics, onMetrics, ... })`.
Le `getToken` est un callback qui doit retourner un JWT frais — appelle
ta route backend `/api/player-token`.

`mode: 'mse'` (recommandé) auto-résout au runtime entre `ManagedMediaSource`
(iOS / macOS Safari 17.1+), `MediaSource` classique (autres browsers) et
fallback `blob` (iOS <17.1). Aucun changement de code partenaire pour iOS.

**Helpers prefetch** (exportés depuis le même package) :
- `prefetchAlbum(workerUrl, token, cb)` — fire-and-forget au mount de la page album, divise la latence `play→canplay` par ~3-4.
- `prefetchSession(workerUrl, token, ref)` — pour auto-advance gapless (call sur `timeupdate` quand `duration - currentTime < 5`).
- `prefetchTracks(workerUrl, token, refs[])` — pour playlist hétérogène.

**Playlist dynamique** : classe `Playlist({ workerUrl, getToken, audioElement, items, onCurrentChange })`. Compose `SecureAudioPlayer`, gère auto-advance + lookahead (session N+1/N+2 + KV N+5) + mutations live (`insert`, `move`, `remove`, `setItems`). Cf `docs/advanced-integration.md` §2.

### Offline encrypted (mobile uniquement)

Pour la lecture offline sans réseau, le partenaire intègre l'un des
modules natifs vendorés dans `modules/` du présent repo :
- `modules/offline-core/` — Swift Package (iOS 15+)
- `modules/offline-core-android/` — Gradle library (Android API 24+)
- `demos/react-native/modules/offline/` — Expo Module wrapper RN

Flux : `POST /offline/license` → ciphertext download via URL signée →
`OfflineModule.ingestDownload(...)` côté natif → lecture via `AVPlayer`
(iOS) / `ExoPlayer` (Android) avec resource loader qui décrypte à la
volée. TTL license par défaut 30 jours, clampé sur `sub_exp` JWT si
présent. Cf `docs/advanced-integration.md` §4.

**Web : pas supporté.** On ne protège pas une clé symétrique en JS browser.

### Module player natif RN (`@demos/offline`) — Pattern B

Pour les apps React Native qui veulent lock-screen + gapless + fiabilité Android sans WebView.
Vendoré dans `demos/react-native/modules/offline/` + `modules/offline-core{,-android}/`.
**Pattern A (WebView)** reste supporté — Pattern B est le chemin recommandé.

**Setup :**

```typescript
import { Player } from '@demos/offline'

// Une seule fois au boot (dans _layout.tsx ou App.tsx) :
Player.configure({
  baseUrl: 'https://secure-stream.musicme.com',
  tokenProvider: async () => {
    const { token } = await fetch('/api/player-token', { method: 'POST', credentials: 'include' }).then(r => r.json())
    return token
  },
})
```

Le `Player` singleton rafraîchit le token toutes les 4 minutes.

**Composant vue :**

```typescript
import { NativePlayer } from '@demos/offline'

<NativePlayer
  trackRef={{ cb: 5400863209100, disc: 1, track: 3 }}
  playing={isPlaying}
  seekToMs={seekPosition}   // null = pas de seek
  title="Fête foraine"
  artist="Christophe Maé"
  coverUrl="https://example.com/cover.jpg"
  onReady={() => …}
  onTimeUpdate={(e) => setPosition(e.nativeEvent.positionMs)}
  onEnded={() => playNext()}
  onError={(e) => console.error(e.nativeEvent.message)}
  onMetrics={(report) => sendAnalytics(report)}
/>
```

Lock-screen (Now Playing iOS + AirPods + seek bar; MediaSession + foreground service Android) configuré automatiquement à chaque `load()`.

**Gapless prefetch :**

```typescript
// Sur timeupdate quand positionMs >= durationMs - 5000 :
void Player.prefetch(nextRef).catch(() => {})
```

**Métriques — `PlayMetricsReport` émis via `onMetrics` :**

```typescript
interface PlayMetricsReport {
  bootstrapMs: number       // POST /init-stream → réponse
  firstKeyMs: number        // toujours 0 (clé incluse dans bootstrap)
  firstRangeMs: number      // premier GET /stream/<sid> décrypté
  firstCanplayMs: number    // bootstrap + premier range → player ready
  totalPlayMs: number
  bufferUnderruns: number
  sessionRotations: number
  fileSizeBytes: number
  outcome: 'completed' | 'aborted' | 'error'
}
```

**Dépendances npm à retirer lors de la migration Pattern A → B :**
`react-native-webview`, `@cyberscaling/secure-audio-stream-client` (pour RN).
Le bundle `player-web/` + l'asset `assets/player.html` sont supprimés.

Cf `docs/advanced-integration.md` §4.3 et §5 (Migration WebView→Natif).

### Origines acceptées

`https://...` ou loopback dev (`http://localhost`, `http://127.0.0.1`,
`http://[::1]` avec port optionnel). Tout autre `http://` rejeté.

---

## Outils MCP disponibles

Si le MCP `musicme-onboarding` est mounted, ces tools sont dispos:

- `register_partner(partner_id, name, allowed_origins)` — création one-shot.
  Renvoie `mint_key` UNE seule fois. Insister auprès de l'utilisateur pour
  qu'il le copie dans son secret manager AVANT de fermer la conversation.
- `get_partner_status(partner_id)` — relire la config (sans secrets).
- `update_allowed_origins(partner_id, allowed_origins)` — replace origins.
- `integration_guide()` — pointer vers le doc complet.

Toujours préférer ces tools plutôt que des `curl` manuels.

---

## Troubleshooting

Cas courants pendant le flow d'intégration. Cite l'erreur exacte que
l'utilisateur voit pour que ce soit grep-able.

### Phase 1 (audit)
| Symptôme | Cause | Fix |
|---|---|---|
| audit ne détecte aucun système d'auth | site purement statique | proposer un mini-backend (e.g. Cloudflare Worker, Vercel Edge Function) — sans backend, pas de mint, pas de musicme |
| audit ne détecte aucun player audio | normal | OK, on en crée un en phase 5 (WI-04) |
| catalogue introuvable | normal | en phase 2, demander à l'utilisateur la source des `(cb, disc, track)`; sinon hardcoder un sample en phase 5 |

### Phase 2 (clarify)
| Symptôme | Cause | Fix |
|---|---|---|
| utilisateur ne sait pas quoi répondre | trop technique | reformuler en 1 phrase non-tech, donner un exemple |
| utilisateur veut "tout configurer plus tard" | OK | défauts raisonnables + flag dans les specs comme TODO |

### Phase 3-4 (specs / tests)
| Symptôme | Cause | Fix |
|---|---|---|
| trop de WI (>15) | scope creep | regrouper, déprioriser au TODO |
| sous-agents proposés pour des WI dépendants | erreur de DAG | re-vérifier, ne paralléliser que si pas de fichiers partagés |
| pas de fixture (cb, disc, track) | catalogue vide | utiliser cb=5400863209100, disc=1, track=1 (catalogue démo musicme) |

### Phase 5 (impl)
| Symptôme | Cause | Fix |
|---|---|---|
| `mint failed: HTTP 401 missing_mint_key` | header `X-Mint-Key` absent / typo | vérifier que la route lit `process.env.MINT_KEY` (pas `MUSICME_MINT_KEY`) |
| `mint failed: HTTP 401 invalid_mint_key` | clé révoquée ou mauvaise | demander à l'opérateur musicme un nouveau mint key |
| `mint failed: HTTP 400 partner_not_in_managed_mode` | partenaire pas en managed | l'opérateur fait `POST /api/admin/keys/<id>/rotate` |
| `init-stream HTTP 401 invalid_token` | JWT expiré ou clock skew | resync l'horloge serveur (NTP); vérifier que `exp` est en secondes UNIX, pas en ms |
| `init-stream HTTP 404 track_not_found` | `(cb, disc, track)` pas dans catalogue | confirmer l'identifiant; si test, utiliser le sample 5400863209100/1/1 |
| `stream HTTP 403 fingerprint_mismatch` | session ouverte par un client, consommée par un autre (proxy/iframe) | s'assurer que `/init-stream` et `/stream/<sid>` viennent du même browser |
| `stream HTTP 410 session_expired` | session > TTL (5 min) | normal — le SDK gère via `onSessionExpired`; recommencer |
| Erreur CORS sur `/init-stream` | origine pas dans `allowed_origins` | call `update_allowed_origins(partner_id, [...nouvelle liste...])` via MCP |
| MSE `SourceBuffer error code=4` | MP4 non fragmenté | mode `mse` du SDK fragmente au vol via mp4box.js; sinon `mode: 'blob'` |
| `<audio>.duration === NaN` | l'audio n'a pas commencé à charger | attendre `onLoaded` callback du SDK avant de lire `duration` |

### Features avancées
| Symptôme | Cause | Fix |
|---|---|---|
| `prefetchAlbum` fail silencieux | endpoint absent côté worker | vérifier que le partenaire pointe sur stream worker récent ; sinon le helper `.catch()` non-fatal masque l'erreur, vérifier le network tab |
| `Playlist` ne fait pas auto-advance | `audioElement` recréé à chaque render | mémoiser l'élément (`useRef` ou `useMemo`), instancier `Playlist` une fois |
| RN `Cannot find native module 'OfflineExpoModule'` | binaire app construit avant l'autolinking du module | re-run `expo prebuild` puis `expo run:ios` / `run:android` |
| Offline 403 `subscription_expired` au mint | JWT `sub_exp <= now` | renouveler abonnement utilisateur côté backend partenaire ; le worker refuse avant tout I/O |
| Offline `SubscriptionExpiredError` levée côté JS | même cause que ci-dessus | UI partenaire doit montrer "Renouvelle ton abonnement" + arrêter d'appeler `refreshExpiringLicenses` |
| Offline iOS `kCFErrorDomainCFNetwork -1100` | URL `offline://...` mal interprétée par AVPlayer | s'assurer que le `AVAssetResourceLoaderDelegate` est attaché AVANT `play()` |
| Offline Android `Source error` ExoPlayer | DataSource pas enregistré | passer `OfflineAssetDataSource.Factory(service)` au `ProgressiveMediaSource.Factory(...)` |
| Logout laisse des downloads | `OfflineModule.wipeAll()` jamais appelé | wire dans le flow logout (best-effort, swallow erreur si module natif absent en Expo Go) |
| RN Pattern B — `NativePlayer` ne produit pas de son | `Player.configure()` pas appelé avant le premier `trackRef` | appeler `Player.configure({ baseUrl, tokenProvider })` une fois au root layout avant tout render de `NativePlayer` |
| RN Pattern B — lock-screen ne s'affiche pas | `UIBackgroundModes` non configuré | vérifier `app.json > ios.infoPlist.UIBackgroundModes: ['audio']` + rebuild |
| RN Pattern B vs Pattern A — quelle path ? | choix d'architecture | Pattern A (WebView) suffit pour intégration rapide sans code natif. Pattern B recommandé si : lock-screen requis, Android fiabilité critique, gapless souhaité, métriques nécessaires. Cf `docs/integration-guide.md` §6.5.2 |

### Phase 6 (docs)
| Symptôme | Cause | Fix |
|---|---|---|
| projet n'a pas de répertoire `docs/` | convention différente | mettre dans `README.md` directement, ou créer `docs/` |
| pas de CI configuré | normal | section "Comment déployer" devient un TODO |

---

## Anti-patterns à éviter

1. **Ne pas** mettre `MUSICME_MINT_KEY` dans le bundle frontend ou le
   localStorage — c'est un secret backend uniquement.
2. **Ne pas** réutiliser un `sessionId` minté côté backend pour le
   servir au frontend — la session est liée à un fingerprint
   (IP+UA hashés). Toujours laisser le frontend appeler
   `/init-stream` lui-même.
3. **Ne pas** mettre en cache un JWT plus longtemps que son `exp`. Le
   SDK rappelle `getToken()` à chaque morceau, c'est suffisant.
4. **Ne pas** committer `.env` ou la `MINT_KEY` dans Git. Vérifier
   `.gitignore` avant le premier `git add`.
5. **Ne pas** activer `DEV_AUTH_BYPASS=1` côté musicme en prod (c'est
   une variable côté admin-worker musicme, pas du côté partenaire —
   mais un partenaire qui demande à l'opérateur de l'activer
   "juste pour tester" doit s'entendre dire non).
6. **Ne pas** changer manuellement les valeurs de `partners.jwks_url`
   ou `partners.expected_iss` — gérer via les outils MCP / l'opérateur.

---

## Décisions par défaut (si l'utilisateur ne tranche pas)

| Décision | Défaut |
|---|---|
| Player mode | `'mse'` |
| JWT TTL côté `/api/internal/mint` | 300s |
| Cache JWT côté frontend | aucun (re-mint à chaque morceau) |
| Stratégie d'erreur SDK | callback `onError` → toast + log; `onSessionExpired` → recharger session |
| Origines à enregistrer | `[<prod>, <staging>, http://localhost:<port>]` (port deviné depuis le `dev` script) |
| Fixture de test | `{cb: 5400863209100, disc: 1, track: 1}` |
| Identifiant `sub` | colonne `id` ou `uuid` de la table users; à défaut hash sha256 de l'email |
| Emplacement du runbook | `docs/musicme-runbook.md` |

Dans le doute, **prends le défaut et signale-le** dans la sortie. L'humain
peut corriger après.

---

## Notes pour ne PAS dériver

- Cette skill ne fait **pas** d'audit de sécurité approfondi du site
  partenaire (ce serait hors scope).
- Cette skill ne déploie **pas** automatiquement (commit + push). C'est
  l'humain qui pilote le déploiement.
- Cette skill ne configure **pas** le CI du partenaire — elle peut le
  proposer en TODO si l'audit n'en a pas trouvé.
- Cette skill ne crée **pas** de comptes utilisateur de test — elle
  utilise les comptes existants identifiés en phase 1.

Si l'utilisateur sort du scope (ex: "ajoute aussi un système de
recommandation"), répondre brièvement que c'est hors flow et proposer
de revenir aux 6 phases ou de traiter ce point à part.
