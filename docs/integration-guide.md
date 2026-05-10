# Guide d'intégration partenaire — musicme

Ce document s'adresse à un développeur qui veut **streamer la musique de notre catalogue depuis son propre site web** (lecteur audio sur sa page, paiement et logique métier de son côté). Il est volontairement progressif : la section *Vue d'ensemble* est compréhensible sans bagage cryptographique, puis on descend dans les détails techniques pour l'implémentation.

> Public visé : développeur web qui sait écrire du code TypeScript / JavaScript (ou un équivalent) et qui peut faire un appel HTTP côté backend. Aucun prérequis sur les JWT, JWKS ou AES.

---

## 0. TL;DR

1. L'opérateur musicme te transmet une **clé d'onboarding** (`ONBOARDING_API_KEY`). Tu installes notre **MCP server** dans ton éditeur (Claude Code, Cursor, Claude Desktop) avec cette clé en variable d'environnement, puis tu demandes à l'agent : *« registre un nouveau partenaire `mon-site` avec origin `https://www.mon-site.fr` »*. L'agent appelle l'API d'onboarding et te renvoie une **clé de mint** (`MINT_KEY`) à stocker **immédiatement** dans ton gestionnaire de secrets — elle ne s'affichera jamais plus.
2. Côté **ton backend** (Node, PHP, Python, peu importe), tu fais un appel HTTP à notre serveur `admin-stream.musicme.cc` pour échanger la `MINT_KEY` contre un **JWT** (jeton court, 5 minutes de durée de vie).
3. Côté **ton frontend** (la page web où le lecteur tourne), tu prends ce JWT et tu l'envoies au serveur de streaming `stream.musicme.cc` qui te retourne un identifiant de session + une URL de stream + une URL de clé.
4. Ton lecteur **télécharge l'audio chiffré** depuis l'URL de stream, **récupère la clé** depuis l'URL de clé, **déchiffre** au vol et joue. Tu n'as pas à écrire la partie crypto : on fournit un SDK JavaScript prêt à l'emploi.

Total : 1 endpoint HTTP côté backend + ~10 lignes de code côté frontend. L'onboarding lui-même prend ~2 minutes via le MCP.

---

## 1. Vue d'ensemble (sans jargon)

### 1.1 Qu'est-ce qu'on protège, et contre quoi ?

Le catalogue audio est stocké chiffré sur nos serveurs. Quand un utilisateur final (un client de **ton** site) clique sur "Play", on doit :

- vérifier que **toi** (le partenaire) as bien payé / a bien le droit de servir ce morceau ;
- empêcher que l'utilisateur **télécharge** ou **redistribue** le fichier audio brut ;
- limiter l'accès à une **session courte** (quelques minutes) pour ce morceau précis, sur cet utilisateur précis.

On utilise pour ça trois mécanismes :

1. **Authentification du partenaire** par signature cryptographique (≈ "carte d'identité numérique").
2. **Chiffrement du flux audio** : les octets envoyés au navigateur sont aléatoires sans la clé, et la clé n'est délivrée qu'à un navigateur qui présente une session valide.
3. **Empreinte de session** (IP + user-agent) : on fait un peu plus que vérifier la session, on vérifie que c'est le **même** utilisateur qui consomme la session.

Tu n'as à t'occuper que du point 1 — l'auth. Les points 2 et 3 sont gérés par notre infra et par le SDK.

### 1.2 La métaphore : un coffre-fort

Imagine ton site comme une banque, et notre serveur audio comme la salle des coffres :

- **Toi (la banque)** as une signature officielle reconnue par le coffre-fort.
- Quand un client de ta banque demande un titre, **tu** (la banque) signes un **bon de retrait** valable 5 minutes pour ce client précis et ce titre précis.
- Le client présente le bon au coffre-fort. Le coffre vérifie ta signature, vérifie que le bon n'est pas expiré, puis livre le morceau **dans une enveloppe scellée**.
- L'enveloppe ne peut être ouverte qu'avec une clé que le coffre fournit séparément, **uniquement** au client qui a présenté le bon.
- Si quelqu'un intercepte le morceau en transit, il n'a que des octets aléatoires.

Le **bon de retrait** = **JWT** (JSON Web Token). C'est le seul concept à intégrer.

### 1.3 Pourquoi un système à deux étages ?

Parce qu'on ne fait **pas confiance** au navigateur de l'utilisateur final. Un navigateur peut être trafiqué (extensions, scripts injectés, etc.). En revanche, on **fait confiance** à ton serveur : c'est toi qui décides qui a le droit de jouer quoi.

D'où la séparation :
- ton **backend** (sécurisé, derrière mot de passe / session de ton site) demande le bon de retrait (JWT) et le passe au frontend ;
- ton **frontend** (navigateur de l'utilisateur, public) ne fait qu'**utiliser** ce bon, sans pouvoir en générer un autre.

Si un attaquant vole un JWT en transit, il peut écouter **un seul morceau pendant 5 minutes**. Pas de fuite globale.

---

## 2. Architecture en un coup d'œil

```
┌──────────────────────────────┐         ┌─────────────────────────────────┐
│  Ton site web                │         │  Infra musicme                  │
│  (chez toi)                  │         │  (chez nous)                    │
│                              │         │                                 │
│  ┌───────────┐               │         │   ┌─────────────────────────┐   │
│  │ Backend   │── 1. mint ───▶│         │   │  admin-stream.musicme.cc │   │
│  │ (Node/…)  │   X-Mint-Key  │         │   │  /internal/mint/<id>    │   │
│  │           │◀── JWT ───────│─────────┼──▶│                          │   │
│  └─────┬─────┘               │         │   └────────────┬─────────────┘   │
│        │                     │         │                │                 │
│        │ 2. fournir JWT      │         │                │ signe avec      │
│        ▼                     │         │                │ clé privée du   │
│  ┌───────────┐               │         │                │ partenaire      │
│  │ Frontend  │── 3. init ───▶│─────────┼─────────┐      │ (managée)       │
│  │ (lecteur) │   Bearer JWT  │         │         ▼      │                 │
│  │           │◀── streamUrl ─│         │   ┌────────────┴─────────────┐   │
│  │           │   keyUrl      │         │   │  stream.musicme.cc       │   │
│  │           │── 4. /stream─▶│─────────┼──▶│  /init-stream            │   │
│  │           │   /key        │         │   │  /stream/<sid>           │   │
│  │           │◀── octets ────│         │   │  /key/<sid>              │   │
│  │           │   chiffrés +  │         │   │  /heartbeat/<sid>        │   │
│  │           │   clé         │         │   └──────────────────────────┘   │
│  └───────────┘               │         │                                  │
│                              │         │                                  │
└──────────────────────────────┘         └──────────────────────────────────┘
```

Trois composants sur lesquels tu interviens :

| Composant | Où ça tourne | Tu écris |
|---|---|---|
| Backend mint | Ton serveur (Node/PHP/etc.) | ~30 lignes : un fetch HTTP |
| Frontend lecteur | Navigateur du client | ~10 lignes via le SDK |
| Endpoint API privée | Ton serveur (route entre frontend et backend) | 1 route qui rend le JWT au frontend |

Tout le reste — la signature, la résolution du partenaire, le chiffrement / déchiffrement, la session, l'analytics — est géré par notre infra et le SDK client.

---

## 3. Deux modes d'auth — bref comparatif

Il existe deux façons d'être un partenaire chez nous :

| Mode | Principe | Pour qui ? |
|---|---|---|
| **`managed`** (recommandé) | Nous générons et hébergeons ta paire de clés cryptographiques. Tu nous demandes un JWT à la volée via un endpoint privé. | Site qui n'a pas de DSI dédiée crypto, intégration rapide. |
| **`jwks`** (autonome) | Tu génères tes propres clés, tu héberges ton propre endpoint JWKS public, tu signes les JWT toi-même. | Plateforme avec des contraintes de souveraineté ou un fournisseur d'identité existant. |

Ce guide couvre le **mode managed**, qui est le plus simple. Le mode `jwks` est documenté séparément.

---

## 4. Mode managed — flow détaillé

```
   ┌─ Ton backend ─┐                ┌─ admin-stream.musicme.cc ─┐
   │               │                │                            │
   │  POST /api/   │                │  POST /internal/mint/      │
   │  player-token │                │       <partnerId>          │
   │  (depuis      │                │  Header: X-Mint-Key: <key> │
   │   frontend)   │                │  Body  : {"sub":"user-42", │
   │      │        │                │           "ttl_seconds":   │
   │      ▼        │                │           300}             │
   │  fetch admin- │── X-Mint-Key ─▶│                            │
   │  stream...    │                │  → vérifie clé             │
   │               │                │  → vérifie IP allowlist    │
   │               │                │  → charge clé privée       │
   │               │◀────── JWT ────│  → signe RS256             │
   │      │        │                │  → renvoie {token, exp}    │
   │      ▼        │                │                            │
   │  retourne     │                └────────────────────────────┘
   │  JWT à        │
   │  frontend     │
   └───────────────┘
```

Trois propriétés importantes :

1. La **clé de mint** (`X-Mint-Key`) ne sort **jamais** de ton serveur. Elle ne doit pas atterrir dans le navigateur, dans Git, dans les logs.
2. Le JWT est **lié à un utilisateur** (`sub`) et **court** (par défaut 300 secondes). Si un client le vole, il peut écouter pendant 5 minutes maximum, pour ce seul utilisateur.
3. Le JWT contient l'identité du partenaire (`iss`) — c'est ce qui permet à `stream.musicme.cc` de retrouver ta clé publique et de vérifier la signature.

---

## 5. Étape A — Création du partenaire

Tu disposes de deux chemins. Le premier (5.1) est recommandé : tu fais l'opération toi-même depuis ton éditeur en quelques minutes. Le second (5.2) reste disponible si l'opérateur musicme préfère faire la création à ta place.

### 5.1 Self-service via le MCP (recommandé)

L'opérateur musicme te transmet **une seule chose** : la valeur d'une `ONBOARDING_API_KEY` (chaîne hex de 64 caractères). C'est cette clé qui te donne le droit de créer ta propre entrée partenaire.

**Installation du MCP**

Le MCP server est publié sous forme de paquet Python sur GitHub. Avec `uv` installé ([instructions](https://docs.astral.sh/uv/getting-started/installation/)), aucune install préalable n'est nécessaire — `uvx` télécharge et met en cache à la première utilisation.

Ajoute le bloc suivant à la config MCP de ton éditeur :

- **Claude Code** : `.mcp.json` à la racine du projet
- **Cursor** : `~/.cursor/mcp.json`
- **Claude Desktop** : `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "musicme-onboarding": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/cyberscaling/musicme-onboarding-mcp.git@v0.2.0",
        "musicme-onboarding-mcp"
      ],
      "env": {
        "MUSICME_ADMIN_URL": "https://admin-stream.musicme.cc",
        "MUSICME_ONBOARDING_API_KEY": "<la valeur transmise par l'opérateur musicme>"
      }
    }
  }
}
```

Redémarre l'éditeur. Les logs stderr du MCP doivent afficher :

```
[musicme-partner-onboarding] starting admin_url=https://admin-stream.musicme.cc key_present=yes
```

Si `key_present=NO`, ta variable d'environnement n'est pas remontée — vérifie le bloc `env` du JSON et redémarre.

**Création du partenaire**

Demande simplement à l'agent dans ton éditeur :

> *« Registre un nouveau partenaire musicme. id = `mon-site`, name = `Mon Site Musique`, allowed_origins = [`https://www.mon-site.fr`]. »*

L'agent appelle l'outil MCP `register_partner`, qui POST `/api/onboarding/partners` côté musicme. En une seule opération atomique on :

- crée la ligne `partners` (mode `managed`)
- génère une paire RSA-2048 et la stocke côté musicme (clé publique exposée, clé privée jamais transmise)
- mint une `MINT_KEY` (préfixe `sk_mint_…`)
- log l'action dans l'audit musicme

Réponse :

```jsonc
{
  "ok": true,
  "instructions": "STORE THE `mint_key` BELOW NOW — it cannot be retrieved later …",
  "partner_id": "mon-site",
  "mint_key": "sk_mint_<64 chars>",      // ← À COPIER MAINTENANT
  "mint_key_id": "01HX…",
  "mint_key_prefix": "sk_mint_<8 chars>",
  "jwks_url": "https://admin-stream.musicme.cc/api/jwks/mon-site",
  "expected_iss": "https://admin-stream.musicme.cc",
  "expected_aud": "secure-audio-stream",
  "stream_url": "https://stream.musicme.cc",
  "admin_url": "https://admin-stream.musicme.cc",
  "kid": "key_<…>"
}
```

⚠️ **Le champ `mint_key` n'apparaîtra plus jamais.** Avant que tu fasses la moindre autre chose, copie-le dans ton gestionnaire de secrets (1Password, Vault, AWS Secrets Manager, GCP Secret Manager, etc.) sous le label `MUSICME_MINT_KEY`. Si tu le perds, il faut révoquer + en re-mint un autre via l'opérateur musicme.

**Vérification**

L'outil MCP `get_partner_status(partner_id)` permet de relire la configuration sans rien révéler de secret :

> *« Vérifie le statut du partenaire `mon-site`. »*

Réponse type : `{ active: true, has_active_managed_key: true, active_mint_keys: 1, … }`. Confirme que tout est en place.

**Mise à jour des `allowed_origins`**

Les origines déclarées à l'inscription peuvent être modifiées à tout moment via l'outil `update_allowed_origins(partner_id, allowed_origins)`. La nouvelle liste **remplace** entièrement l'ancienne (pas de diff). Cas d'usage typiques :

- ajout d'un origin de dev local : `["https://www.mon-site.fr", "http://localhost:5173"]`
- bascule prod ↔ staging
- ajout d'un second domaine de déploiement

> *« Update les allowed_origins du partenaire `mon-site` avec `https://www.mon-site.fr` et `http://localhost:5173`. »*

Origines acceptées : `https://...` (prod / staging) ou loopback dev (`http://localhost`, `http://127.0.0.1`, `http://[::1]` avec port optionnel). Tout autre `http://` (domaine public non-localhost) est rejeté.

**Skill + prompts pour l'intégration complète**

Le repo MCP livre aussi :

- [`skill/musicme-integration/`](https://github.com/cyberscaling/musicme-onboarding-mcp/tree/main/skill) — skill Claude Code / Cursor qui orchestre tout le flow d'intégration en 6 étapes (audit → specs → tests → implémentation → docs).
- [`prompts/integration-prompts.md`](https://github.com/cyberscaling/musicme-onboarding-mcp/blob/main/prompts/integration-prompts.md) — les 6 prompts copy-pasteable, à enchaîner dans une session Claude Code après installation de la skill.

À installer côté partenaire avant de démarrer l'intégration :

```bash
# depuis la racine du projet à intégrer
git clone https://github.com/cyberscaling/musicme-onboarding-mcp.git /tmp/musicme-mcp
mkdir -p .claude/skills
cp -R /tmp/musicme-mcp/skill/musicme-integration .claude/skills/
```

Puis dans Claude Code : `/musicme-integration` pour activer la skill, et coller le prompt 1 (audit) du fichier `integration-prompts.md`.

### 5.2 Création manuelle par l'opérateur musicme (fallback)

Si pour une raison ou une autre tu n'utilises pas le MCP, Pierre peut faire la création depuis l'admin UI. Sur `https://admin-stream.musicme.cc`, l'admin :

1. crée un partenaire (`POST /api/partners`) avec `id`, `name`, `allowed_origins` ;
2. bascule en mode managé (`POST /api/admin/keys/<id>/rotate`) — génère la paire RSA-2048, met `auth_mode = 'managed'`, fixe `jwks_url = https://admin-stream.musicme.cc/api/jwks/<id>` ;
3. crée une clé de mint (`POST /api/partners/<id>/keys` avec `scope='mint'`) et te la communique **une seule fois**.

Le résultat est identique au flux 5.1.

### 5.3 Ce que tu reçois — récapitulatif

| Donnée | Exemple | À garder où ? |
|---|---|---|
| `partnerId` | `mon-site` | dans tes envvars (`PARTNER_ID`) |
| `MINT_KEY` | `sk_mint_…` (~70 chars) | dans tes envvars (`MINT_KEY`), **jamais en dur dans le code** |
| URL admin | `https://admin-stream.musicme.cc` | constante |
| URL stream | `https://stream.musicme.cc` | constante |

---

## 6. Étape B — Intégration côté site partenaire

### 6.1 Vue rapide

Tu vas créer trois bouts de code :

1. Une **route backend** `POST /api/player-token` qui prend un identifiant utilisateur (récupéré depuis ta session de site) et qui renvoie un JWT. C'est ici que la `MINT_KEY` est utilisée.
2. Une **page frontend** qui héberge le lecteur audio et qui appelle cette route quand l'utilisateur veut jouer un morceau.
3. (Optionnel) **Un endpoint** qui te permet de récupérer la liste des morceaux à jouer (catalogue, recherche, etc.) — ça, c'est ton métier, pas le nôtre.

### 6.2 Backend — minter un JWT

Voici une implémentation Node / TypeScript. Adapte le langage à ton stack ; le contenu HTTP reste identique.

```typescript
// server/routes/player-token.ts (Node 18+ ou Bun)

const ADMIN_URL = process.env.ADMIN_URL ?? 'https://admin-stream.musicme.cc'
const PARTNER_ID = process.env.PARTNER_ID ?? 'mon-site'
const MINT_KEY = process.env.MINT_KEY ?? ''

if (!MINT_KEY) {
  throw new Error('MINT_KEY env var must be set on the server (never exposed to browser)')
}

/**
 * Mint a JWT for a logged-in user. Returns { token, exp }.
 * `userId` is whatever you use as a primary user identifier in your DB
 * (UUID, email hash, etc.). It will be hashed downstream for analytics.
 */
export async function mintPlayerToken(
  userId: string,
  extras: { country?: string; tier?: string } = {},
): Promise<{ token: string; exp: number }> {
  const r = await fetch(`${ADMIN_URL}/api/internal/mint/${PARTNER_ID}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mint-Key': MINT_KEY,
    },
    body: JSON.stringify({
      sub: userId,
      ttl_seconds: 300, // 5 min — lifetime of the JWT, not the audio session
      claims: extras,   // arbitrary extra claims, surfaced in our analytics
    }),
  })

  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`mint failed: HTTP ${r.status}: ${detail}`)
  }
  return (await r.json()) as { token: string; exp: number }
}
```

L'utilisation depuis une route HTTP (exemple avec Hono — adapte à Express / Fastify / etc.) :

```typescript
// server/routes/api.ts
import { Hono } from 'hono'
import { mintPlayerToken } from './player-token'

const api = new Hono()

api.post('/player-token', async (c) => {
  // 1. ta logique de session — vérifie que l'utilisateur est logué.
  //    Refuse l'endpoint sinon (401), sinon n'importe qui peut miner des JWT
  //    au nom de ton partenaire et consommer ton quota.
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'unauthenticated' }, 401)

  // 2. (optionnel) vérifie que cet utilisateur a le droit de jouer
  //    (abonnement actif, quota du jour pas dépassé, géoblocage, etc.).
  if (!user.canStream) return c.json({ error: 'forbidden' }, 403)

  // 3. mint et renvoie au frontend.
  const { token, exp } = await mintPlayerToken(user.id, {
    country: user.country,
    tier: user.subscription_tier,
  })
  return c.json({ token, expiresAt: exp * 1000 })
})

export default api
```

**Points de vigilance** :

- Cette route doit être **derrière l'auth de ton site**. Sinon n'importe qui sur le web peut récupérer un JWT et streamer en exploitant ton quota.
- Le JWT renvoyé est **utilisable une seule fois** par init-stream (en pratique, plusieurs fois pendant ses 5 minutes de validité, mais à l'usage on en redemande un par morceau).
- **Ne stocke pas le JWT dans `localStorage`** au-delà de quelques minutes — sa durée de vie est courte, et il vaut mieux en demander un nouveau à chaque morceau.
- L'IP du serveur depuis lequel tu fais ce mint doit être déclarée dans `INTERNAL_MINT_CIDRS` côté admin musicme. Sinon le mint échoue avec `ip_not_allowed` (403).

### 6.3 Frontend — utiliser le SDK

Le SDK est publié sur npm sous `@cyberscaling/secure-audio-stream-client`. Install :

```bash
bun add @cyberscaling/secure-audio-stream-client
# ou: pnpm add / npm install / yarn add
```

Usage :

```typescript
// frontend/src/player.ts
import { SecureAudioPlayer } from '@cyberscaling/secure-audio-stream-client'

const STREAM_URL = 'https://stream.musicme.cc'

const player = new SecureAudioPlayer({
  workerUrl: STREAM_URL,
  // À chaque chargement de morceau, le SDK appelle ce callback pour récupérer
  // un JWT frais. Tu fais un fetch sur ta route /api/player-token (qui est
  // derrière l'auth de session de ton site).
  getToken: async () => {
    const r = await fetch('/api/player-token', { method: 'POST', credentials: 'include' })
    if (!r.ok) throw new Error(`token fetch failed: ${r.status}`)
    const { token } = (await r.json()) as { token: string }
    return token
  },
  mode: 'mse', // recommandé. 'blob' pour fallback / debug.
  onError: (err) => console.error('[player]', err),
  onLoaded: () => console.log('[player] ready to play'),
  onProgress: (loaded, total) => {
    // Affiche une barre de chargement si tu veux.
  },
  onSessionExpired: () => {
    // Le JWT a expiré (rare en pratique). Détruire et recréer.
    player.destroy()
  },
})

// Attache l'élément <audio> géré par le player à ton DOM.
document.querySelector('#player-container')!.append(player.audio)

// Joue un morceau identifié par (cb, disc, track).
// (Ces trois nombres viennent de ton catalogue / de ton API métier.)
await player.load({ cb: 5400863209100, disc: 1, track: 1 })
await player.play()
```

C'est tout. Le SDK :
- appelle `/init-stream` avec le JWT pour ouvrir une session,
- récupère la clé AES via `/key/<sid>`,
- télécharge le morceau par tranches via `/stream/<sid>` avec des en-têtes `Range`,
- déchiffre chaque tranche avec WebCrypto + l'API MediaSource,
- envoie un `/heartbeat` toutes les 10 secondes pour qu'on facture précisément le temps d'écoute (et pour qu'on coupe la session à la fermeture d'onglet),
- expose un `<audio>` HTML standard que tu peux styler comme n'importe quel élément.

> **iOS — important**. `mode: 'mse'` couvre désormais trois chemins, choisis automatiquement par le SDK selon le navigateur. **Aucune modif du code partenaire n'est nécessaire** pour activer le streaming iOS — la même app web fonctionne sur tout le parc :
>
> | Browser détecté | Backend résolu | UX |
> |---|---|---|
> | iOS / macOS Safari **17.1+** | `ManagedMediaSource` (MMS) | Streaming progressif, économe en cellulaire |
> | Chrome / Firefox / Edge / Safari desktop pré-17.1 | `MediaSource` classique | Streaming progressif (comportement actuel) |
> | iOS Safari **<17.1** | `blob` (fallback auto) | Téléchargement complet avant lecture. `onError` reçoit un avertissement non-fatal `mms_fallback: no_media_source`. |
>
> Pour vérifier en prod, active `metrics: { enabled: true }` + `onMetrics` : le champ `report.mode` te dit lequel des trois a été utilisé pour chaque play.

### 6.4 Frontend — sans SDK (référence)

Si tu ne peux pas utiliser le SDK (autre langage, environnement non-web), voici la séquence brute à reproduire :

```http
# 1. /init-stream
POST https://stream.musicme.cc/init-stream
Authorization: Bearer <JWT>
Content-Type: application/json

{ "cb": 5400863209100, "disc": 1, "track": 1 }

→ 200
{
  "sessionId": "<uuid>",
  "fileSize": 2193949,
  "contentType": "application/octet-stream",
  "streamUrl": "/stream/<uuid>",
  "keyUrl": "/key/<uuid>",
  "expiresAt": 1778173137679
}
```

```http
# 2. /key
GET https://stream.musicme.cc/key/<sessionId>

→ 200
{ "key": "<base64 32 bytes>", "iv": "<base64 16 bytes>" }
```

```http
# 3. /stream  (par tranches; Range obligatoire pour gros fichiers)
GET https://stream.musicme.cc/stream/<sessionId>
Range: bytes=0-262143

→ 206 Partial Content
Content-Range: bytes 0-262143/2193949
X-Counter-Start: 0
X-Skip-Bytes: 0
<262144 octets de ciphertext AES-CTR>
```

Algo de déchiffrement (référence — inutile si tu utilises le SDK) :

- Mode : **AES-256-CTR**.
- Clé : 32 octets (base64 dans `key`).
- IV de base : 16 octets (base64 dans `iv`).
- Pour chaque appel `/stream`, le serveur renvoie deux en-têtes :
    - `X-Counter-Start` : index de bloc 16-octets à partir duquel commence cette tranche (entier).
    - `X-Skip-Bytes` : nombre d'octets à ignorer en début de plaintext une fois déchiffré (utile car on aligne le ciphertext sur des frontières de bloc 16 octets ; côté client, on ne montre à l'utilisateur que la portion qu'il a demandée).
- Le compteur 128 bits utilisé pour AES-CTR sur cette tranche est `IV_de_base + X-Counter-Start` (somme big-endian, propagation de retenue à droite).

```typescript
// déchiffrement minimal
async function decryptRange(
  cipher: Uint8Array,
  keyB64: string,
  ivB64: string,
  counterStart: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0)),
    { name: 'AES-CTR' },
    false,
    ['decrypt'],
  )
  const baseIv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0))
  // counter = baseIv + counterStart (big-endian, sur 16 octets)
  const counter = new Uint8Array(16)
  counter.set(baseIv)
  let carry = counterStart
  for (let i = 15; i >= 0 && carry > 0; i--) {
    const sum = counter[i]! + (carry & 0xff)
    counter[i] = sum & 0xff
    carry = (carry >>> 8) + (sum >>> 8)
  }
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-CTR', counter, length: 64 },
    key,
    cipher,
  )
  return new Uint8Array(plain)
}
```

Pour la lecture en MP4 : tu peux soit :
- tout télécharger, déchiffrer, faire un `Blob` et `URL.createObjectURL` → `audio.src` (mode **blob**, simple, mais nécessite la fin du téléchargement avant de jouer) ;
- utiliser MSE + une lib comme `mp4box.js` pour fragmenter à la volée (mode **mse**, ce que fait notre SDK).

### 6.5 Plateformes non-web — iOS natif, Android natif, React Native

Le SDK JavaScript dépend du DOM (`MediaSource` / `ManagedMediaSource`, `fetch`, `crypto.subtle`). Hors d'un navigateur, deux stratégies :

#### 6.5.1 Webapp affichée dans iOS Safari (rappel)

Cas le plus simple — couvert en §6.3 — **rien à faire de spécial**. Le SDK active `ManagedMediaSource` automatiquement à partir d'iOS 17.1 et fallback en `blob` sur les iOS antérieurs. C'est l'option recommandée pour les utilisateurs iPhone qui accèdent à ton site via Safari.

#### 6.5.2 React Native (iOS + Android)

Notre SDK ne tourne **pas** dans le runtime JS de React Native (pas de DOM, pas de `MediaSource`). Deux chemins :

**A. WebView (recommandé)**

Héberge la page web qui utilise le SDK dans un `react-native-webview`. L'engine WebKit d'iOS fournit `ManagedMediaSource` à partir d'iOS 17.1, donc tu obtiens le streaming progressif sans écrire une ligne de code natif.

```tsx
import { WebView } from 'react-native-webview'

<WebView
  source={{ uri: 'https://ton-site.fr/player?track=5400863209100/1/1' }}
  allowsInlineMediaPlayback
  mediaPlaybackRequiresUserAction={false}
/>
```

Côté webapp partenaire, la page hébergée dans la WebView doit avoir l'origine déclarée dans `partners.allowed_origins`. Sur Android, le WebView Chromium supporte aussi `MediaSource` — tu obtiens le mode `mse` standard.

Limites :
- L'UI est celle de ta page web. Si tu veux contrôler le `<audio>` via du natif (lock screen iOS, contrôles AirPods, etc.), il te faut le chemin B.
- Les WebView iOS ne diffusent pas le son en background sans config spécifique du `AVAudioSession` côté natif.

**B. Player natif + bridge custom (chemin lourd)**

Utilise `react-native-track-player` ou `expo-av` avec un module natif qui ré-implémente le flow `init-stream → key → /stream` + déchiffrement AES-CTR. Tu écris l'équivalent du SDK en Swift (iOS) et Kotlin (Android). À considérer **uniquement** si tu as besoin :

- de contrôles de lecture natifs (CarPlay, Now Playing, AirPods),
- de lecture en arrière-plan robuste,
- d'une UX qui dépasse ce que le WebView permet.

Le code Swift / Kotlin nécessaire est décrit dans 6.5.3 et 6.5.4 ; tu l'exposeras à JS via `NativeModules` ou un native module Expo.

#### 6.5.3 Native iOS (Swift / SwiftUI / UIKit)

Approche : `AVPlayer` avec un `AVAssetResourceLoaderDelegate` qui intercepte les range requests, fetch chiffré côté worker, déchiffre AES-CTR via `CryptoKit`, et répond à AVPlayer.

```swift
import AVFoundation
import CryptoKit

struct StreamSession {
    let sessionId: String
    let fileSize: Int
    let keyB64: String
    let ivB64: String
}

final class SecureStreamLoader: NSObject, AVAssetResourceLoaderDelegate {
    private let workerUrl = URL(string: "https://stream.musicme.cc")!
    private let session: StreamSession

    init(session: StreamSession) { self.session = session }

    func resourceLoader(_ loader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource req: AVAssetResourceLoadingRequest) -> Bool {
        if let info = req.contentInformationRequest {
            info.contentType = "audio/mp4"
            info.contentLength = Int64(session.fileSize)
            info.isByteRangeAccessSupported = true
        }
        guard let dataReq = req.dataRequest else { req.finishLoading(); return true }

        let start = Int(dataReq.requestedOffset)
        let end = start + dataReq.requestedLength - 1

        Task {
            do {
                var r = URLRequest(url: workerUrl.appendingPathComponent("stream/\(session.sessionId)"))
                r.setValue("bytes=\(start)-\(end)", forHTTPHeaderField: "Range")
                let (cipher, resp) = try await URLSession.shared.data(for: r)
                let http = resp as! HTTPURLResponse
                let counterStart = Int(http.value(forHTTPHeaderField: "X-Counter-Start") ?? "0") ?? 0
                let skipBytes = Int(http.value(forHTTPHeaderField: "X-Skip-Bytes") ?? "0") ?? 0
                let plain = try aesCtrDecrypt(cipher: cipher,
                                               keyB64: session.keyB64,
                                               ivB64: session.ivB64,
                                               counterStart: counterStart)
                let payload = skipBytes > 0 ? plain.subdata(in: skipBytes..<plain.count) : plain
                dataReq.respond(with: payload)
                req.finishLoading()
            } catch {
                req.finishLoading(with: error)
            }
        }
        return true
    }
}

// AES-256-CTR avec compteur = base IV + counterStart (big-endian add).
func aesCtrDecrypt(cipher: Data, keyB64: String, ivB64: String, counterStart: Int) throws -> Data {
    var counter = [UInt8](Data(base64Encoded: ivB64)!)  // 16 octets
    var carry = counterStart
    var i = 15
    while i >= 0 && carry > 0 {
        let sum = Int(counter[i]) + (carry & 0xff)
        counter[i] = UInt8(sum & 0xff)
        carry = (carry >> 8) + (sum >> 8)
        i -= 1
    }
    // CryptoKit n'expose pas AES-CTR directement. Utilise CommonCrypto (CCCrypt
    // avec kCCAlgorithmAES + kCCModeCTR) ou un wrapper Swift dédié, ex.
    // https://github.com/krzyzanowskim/CryptoSwift `AES(key:..., blockMode: CTR(iv:counter))`.
    fatalError("plug your AES-CTR primitive here (CommonCrypto or CryptoSwift)")
}
```

Câblage avec un scheme custom pour forcer AVPlayer à passer par le delegate :

```swift
let custom = URL(string: "secured://stream/\(session.sessionId)")!
let asset = AVURLAsset(url: custom)
let loader = SecureStreamLoader(session: session)
asset.resourceLoader.setDelegate(loader, queue: DispatchQueue(label: "secure-stream"))
let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
player.play()
```

Étapes en amont (à faire une fois par morceau, depuis ton front natif) :
1. Backend mint d'un JWT (route `/api/player-token` côté ton serveur, identique à la version web).
2. `POST /init-stream` avec `Authorization: Bearer <jwt>` → récupère `sessionId`, `fileSize`, `keyB64`, `ivB64`.
3. Construis la `StreamSession`, instancie `SecureStreamLoader`, lance AVPlayer.
4. Heartbeat : un `Timer.scheduledTimer(withTimeInterval: 10)` qui POST `https://stream.musicme.cc/heartbeat/<sid>` avec `{ duration_ms: player.currentTime * 1000, complete: false }`. Au `playbackEnded` ou `destroy`, envoie un dernier heartbeat avec `complete: true`.

Compter ~150 lignes Swift bien testées (loader + AES-CTR + heartbeat + gestion d'erreur). Ré-implémentation 1:1 du SDK web.

#### 6.5.4 Native Android (Kotlin / Java)

Approche miroir : ExoPlayer + un `DataSource.Factory` custom qui appelle `/init-stream` à l'ouverture du `MediaSource`, puis intercepte les `DataSpec` (offset + length) pour fetch + déchiffrer.

- Déchiffrement : `Cipher.getInstance("AES/CTR/NoPadding")` avec `IvParameterSpec(counterBytes)` où `counterBytes = baseIv + counterStart` (même algo big-endian).
- Heartbeat : `WorkManager` ou `Handler.postDelayed` toutes les 10 s.
- Mêmes endpoints HTTP, mêmes en-têtes (`X-Counter-Start`, `X-Skip-Bytes`) que côté web/iOS.

Pour la même raison qu'en 6.5.3, n'écris ce code que si la WebView ne couvre pas tes besoins UX.

---

## 7. Récap des paramètres à fournir aux humains chez toi

| Variable | Côté | Donné par | Exemple |
|---|---|---|---|
| `PARTNER_ID` | backend | opérateur musicme | `mon-site` |
| `MINT_KEY` | backend | opérateur musicme (one-shot) | `mk_live_…` |
| `ADMIN_URL` | backend | constante | `https://admin-stream.musicme.cc` |
| `STREAM_URL` | frontend | constante | `https://stream.musicme.cc` |
| Allowed origins | déclaré côté admin | Pierre via le partner record | `https://www.mon-site.fr` |
| Static IP serveur | déclaré côté admin (CIDR) | toi → opérateur musicme | `1.2.3.4/32` |

---

## 8. Sécurité — règles à ne pas casser

1. **`MINT_KEY` ne sort jamais du backend.** Si elle fuit, on rotate et on te donne une nouvelle clé. C'est plus douloureux pour toi que pour nous (downtime de ton service le temps que tu mettes à jour). Stocke-la dans un secret manager (Vault, AWS Secrets Manager, GCP Secret Manager, `wrangler secret put` si tu es sur Cloudflare, etc.).
2. **`MINT_KEY` ne va pas dans Git.** Pas en clair, pas dans un fichier `.env` versionné. Utilise `.env` + `.gitignore`.
3. **Ta route `/api/player-token` est derrière l'auth de session.** Sinon, un scrappeur peut récupérer des JWT à la volée et exploiter ton quota.
4. **CORS strict.** Notre worker `stream.musicme.cc` n'accepte que les origines déclarées dans `partners.allowed_origins`. Ajoute toutes les origines depuis lesquelles le lecteur tournera (prod + staging si besoin).
5. **HTTPS partout.** Le JWT et les flux audio doivent rester sur des canaux chiffrés. Tout HTTP est refusé.
6. **Ne loggue pas les JWT côté serveur** dans des logs accessibles. Ils sont courts mais valides.
7. **Le JWT ne donne pas accès au catalogue.** Tu ne peux pas appeler `/init-stream` avec un `cb` arbitraire et espérer trouver "tous les morceaux" : le worker valide chaque `(cb, disc, track)` contre une base interne. Si tu donnes un identifiant qui n'est pas dans le catalogue, tu reçois `404 track_not_found`.

---

## 9. Troubleshooting

### 9.1 Onboarding (MCP)

| Symptôme | Cause probable | Fix |
|---|---|---|
| `missing_config` à chaque appel d'outil MCP | `MUSICME_ONBOARDING_API_KEY` non lu par le serveur MCP | Vérifie le bloc `env` dans la config MCP de ton éditeur ; redémarre l'éditeur après édition. Confirme via les logs stderr du MCP : `key_present=yes` attendu. |
| `unauthorized` (401) sur `register_partner` | Clé d'onboarding mauvaise / révoquée | Contacter l'opérateur musicme pour re-distribuer ou rotate. |
| `partner_exists` (409) | Slug déjà utilisé | Choisir un autre `partner_id`, ou demander à l'opérateur musicme s'il s'agit d'une enregistrement antérieur que tu as oublié. |
| `network_error` | Pas d'accès à `admin-stream.musicme.cc` | Vérifier connectivité, proxy, DNS. |
| L'éditeur ne voit pas l'outil | Le client MCP n'a pas démarré le serveur | Vérifier les logs stderr du client MCP. Tester `uvx --from git+… --help` dans un terminal pour reproduire indépendamment. |

### 9.2 Mint JWT (backend)

| Symptôme | Cause probable | Fix |
|---|---|---|
| `mint failed: HTTP 401 missing_mint_key` | Header `X-Mint-Key` absent ou vide | Vérifie l'envvar ; vérifie que le fetch ne réécrit pas les headers. |
| `mint failed: HTTP 401 invalid_mint_key` | Mauvaise clé, ou clé révoquée | Demande à l'opérateur musicme de re-mint une clé. |
| `mint failed: HTTP 403 ip_not_allowed` | IP du serveur backend pas dans `INTERNAL_MINT_CIDRS` | Donne ton IP statique à l'opérateur musicme. En dev, configurer `DEV_AUTH_BYPASS=1` côté admin (jamais en prod). |
| `mint failed: HTTP 400 partner_not_in_managed_mode` | Partenaire en mode `jwks` côté admin | l'opérateur doit faire `POST /api/admin/keys/<id>/rotate`. |
| `mint failed: HTTP 500 no_active_key` | Aucune clé active pour ton partenaire | l'opérateur doit faire un `rotate` initial pour créer la première paire. |

### 9.3 Streaming (frontend / SDK)

| Symptôme | Cause probable | Fix |
|---|---|---|
| `init-stream HTTP 401 invalid_token` | JWT expiré ou mal signé | Vérifie l'horloge serveur (`exp` est en secondes UNIX UTC). Re-mint et réessaie. |
| `init-stream HTTP 404 track_not_found` | Le `(cb, disc, track)` n'existe pas dans le catalogue | Confirme l'identifiant côté ton catalogue ; nous appeler si tu penses qu'il devrait exister. |
| `stream HTTP 403 fingerprint_mismatch` | Le client qui appelle `/stream` n'a pas la même IP / user-agent que celui qui a fait `/init-stream` | Relance le flow depuis le même navigateur / même session. Ne **pas** réutiliser un `sessionId` minté côté backend pour servir au frontend. |
| `stream HTTP 410 session_expired` | Session > TTL (5 min par défaut) | Le SDK gère ce cas via `onSessionExpired` ; si tu fais ton propre code, recommence à `/init-stream`. |
| Lecture MSE échoue avec `SourceBuffer error code=4` | MP4 non fragmenté | Utiliser `mode: 'mse'` (le SDK fragmente au vol via mp4box.js) ou tomber en `mode: 'blob'`. |
| `403` sur `/stream` côté CORS | Origine pas dans `allowed_origins` | l'opérateur l'ajoute. Vérifie aussi le CORS preflight (OPTIONS). |

Pour aider au debug, le worker écrit ses warnings dans Wrangler Tail :

```bash
# Côté opérateur musicme
bunx wrangler tail secure-audio-stream --env production
```

Demande-lui un coup d'œil si tu coinces sur un comportement non documenté.

---

## 10. Quotas, facturation, analytics

- Chaque appel `/init-stream` est un événement compté côté analytics, même si l'utilisateur ne joue jamais.
- Chaque heartbeat (`/heartbeat/<sid>`) met à jour `bytesServed` et `durationMs` côté serveur. Le SDK envoie un dernier heartbeat avec `complete=true` à la fermeture / fin du morceau, garantissant que la facturation est correcte même en cas de coupure réseau.
- Les claims optionnels `country`, `tier` que tu passes au mint sont propagés dans les events analytics, donc tu peux les exploiter dans le dashboard admin (graphiques par pays, par offre, etc.).
- Si tu dépasses ton quota convenu (en bytes ou en sessions), nous coupons côté worker (HTTP 403 quota_exceeded).

---

## 11. Checklist finale

Onboarding (une fois) :

- [ ] `ONBOARDING_API_KEY` reçue de l'opérateur musicme, stockée dans le gestionnaire de secrets, **pas** dans Git.
- [ ] MCP `musicme-onboarding` déclaré dans `.mcp.json` / config Cursor / config Claude Desktop, redémarrage de l'éditeur fait.
- [ ] `register_partner(...)` appelé une fois, `mint_key` copié dans le gestionnaire de secrets **avant** de fermer la conversation.
- [ ] `get_partner_status(...)` confirme `active=true`, `has_active_managed_key=true`, `active_mint_keys >= 1`.

Avant de pusher en prod :

- [ ] `MINT_KEY` en envvar, pas dans Git, accessible **uniquement** au process backend.
- [ ] Route `/api/player-token` derrière l'auth de session de ton site.
- [ ] Frontend récupère le JWT à chaque morceau (pas de cache long).
- [ ] CORS configuré correctement (test depuis l'origine prod).
- [ ] IP statique de ton backend déclarée à l'opérateur musicme (CIDR allowlist).
- [ ] Smoke test E2E : un utilisateur logué peut jouer un morceau sans erreur console.
- [ ] Heartbeat visible dans les logs admin (Wrangler Tail / dashboard).
- [ ] Page d'erreur si `onSessionExpired` ou `onError` du SDK est appelé (note : `onError` est aussi appelé pour des avertissements **non-fatals** comme `mms_fallback: no_media_source` sur iOS <17.1 ; ne le traite pas comme une fin de lecture si `audio.src` est par la suite assigné).
- [ ] HTTPS strict partout.
- [ ] Smoke iOS : ouvre ton site sur un iPhone, joue un morceau. Si tu actives `metrics: { enabled: true }`, vérifie que `report.mode === 'mms'` sur iOS 17.1+ et `'blob'` sur iOS plus ancien.
- [ ] Si tu cibles React Native ou natif iOS/Android : section §6.5 du présent guide pour le bon chemin (WebView vs réimplémentation native).

Si tu coches tout, l'intégration est prête.

---

## 12. Annexes

### A. Anatomie d'un JWT minté (pour ta culture)

Quand tu fais `POST /api/internal/mint/<partnerId>`, on te renvoie un token comme :

```
eyJhbGciOiJSUzI1NiIsImtpZCI6Im1vbi1zaXRlLTIwMjYwNTA3In0.eyJpc3MiOiJodHRwczovL2FkbWluLXN0cmVhbS5tdXNpY21lLmNjIiwic3ViIjoidXNlci00MiIsImF1ZCI6InNlY3VyZS1hdWRpby1zdHJlYW0iLCJpYXQiOjE3NzgxNzM2MDAsImV4cCI6MTc3ODE3MzkwMH0.<signature>
```

Décodé :

```json
{
  "alg": "RS256",
  "kid": "mon-site-20260507"
}
```
```json
{
  "iss": "https://admin-stream.musicme.cc",
  "sub": "user-42",
  "aud": "secure-audio-stream",
  "iat": 1778173600,
  "exp": 1778173900
}
```

- `iss` : qui a émis le token. Notre stream worker l'utilise pour résoudre la clé publique.
- `sub` : ton identifiant utilisateur (passé en argument du mint).
- `aud` : la cible attendue (toujours `secure-audio-stream` ici).
- `exp` / `iat` : timestamps UNIX en secondes.
- `kid` : identifiant de la clé qui a signé. Si on rotate la clé, l'ancien `kid` reste exposé sur le JWKS pendant 24h, le temps que les tokens en circulation expirent.

Tu n'as pas à parser ce token : tu le passes simplement en `Authorization: Bearer <token>` au stream worker.

### B. Exemple complet : mini app Next.js

Pour aller vite, voici un squelette d'app Next.js (App Router) qui colle tout :

```ts
// app/api/player-token/route.ts
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  // 1. ta session
  const user = await getSessionUser(req) // ta logique
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // 2. mint
  const r = await fetch(
    `${process.env.ADMIN_URL}/api/internal/mint/${process.env.PARTNER_ID}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mint-Key': process.env.MINT_KEY! },
      body: JSON.stringify({ sub: user.id, ttl_seconds: 300 }),
    },
  )
  if (!r.ok) return NextResponse.json({ error: 'mint_failed' }, { status: 502 })
  const { token, exp } = (await r.json()) as { token: string; exp: number }
  return NextResponse.json({ token, expiresAt: exp * 1000 })
}
```

```tsx
// app/(player)/PlayerPage.tsx
'use client'

import { useEffect, useRef } from 'react'
import { SecureAudioPlayer } from '@cyberscaling/secure-audio-stream-client'

export default function PlayerPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<SecureAudioPlayer | null>(null)

  useEffect(() => {
    const p = new SecureAudioPlayer({
      workerUrl: 'https://stream.musicme.cc',
      getToken: async () => {
        const r = await fetch('/api/player-token', { method: 'POST', credentials: 'include' })
        if (!r.ok) throw new Error('token fetch failed')
        const { token } = (await r.json()) as { token: string }
        return token
      },
      onError: console.error,
    })
    containerRef.current?.append(p.audio)
    playerRef.current = p
    return () => p.destroy()
  }, [])

  async function playTrack(cb: number, disc: number, track: number) {
    const p = playerRef.current
    if (!p) return
    await p.load({ cb, disc, track })
    await p.play()
  }

  return (
    <div>
      <div ref={containerRef} />
      <button onClick={() => playTrack(5400863209100, 1, 1)}>Play sample</button>
    </div>
  )
}
```

Avec ces ~70 lignes de code, l'intégration est faite.

---

*Dernière mise à jour : 2026-05-10 — ajout du support iOS via `ManagedMediaSource` (auto-détecté côté SDK, aucun changement partenaire requis) et de la section §6.5 plateformes non-web (React Native, natif iOS/Android). En cas de doute, contacter l'opérateur musicme (le contact t'est fourni en même temps que l'`ONBOARDING_API_KEY`).*
