# Note partenaires — résilience réseau sur `/stream` (2026-08-04)

## Contexte

En mobilité, une coupure réseau transitoire (changement de cellule, tunnel,
Wi-Fi → 4G) peut interrompre le téléchargement d'un range `/stream/<session>`
**en plein corps de réponse**. Sans traitement côté client, ce range perdu
arrête la lecture alors qu'un simple re-essai 500 ms plus tard suffit :
la session reste valide et le serveur ressert le même range à l'identique
(AES-CTR : le déchiffrement repart de `X-Counter-Start`, aucune dépendance à
la tentative précédente).

## Vous utilisez le SDK (`@cyberscaling/secure-audio-stream-client`)

Rien à coder : mettez à jour vers **0.3.2 ou plus**.

```bash
npm install @cyberscaling/secure-audio-stream-client@^0.3.2
```

Comportement depuis 0.3.2 :
- toute erreur **réseau** sur un range (`fetch` rejeté ou corps interrompu)
  est retentée automatiquement 2 fois (backoff 500 ms puis 1 s) ;
- `onError` n'est donc plus appelé pour une micro-coupure — uniquement pour
  un échec durable (> ~2 s sans réseau). Prévoyez-y une reprise applicative
  (relancer la piste) si pertinent pour votre UX ;
- inchangé : `onSessionExpired` (403/410) et les erreurs serveur ne sont
  **jamais** retentées par le SDK.

## Vous n'utilisez pas le SDK (implémentation directe de `/stream`)

Implémentez ce comportement autour de votre fetch de range. Règles :

1. **Retenter uniquement les erreurs réseau** : promesse `fetch` rejetée
   (TypeError & co.) ou échec de lecture du corps (`arrayBuffer()` /
   `read()` rejeté — « network connection lost »).
2. **Ne jamais retenter une réponse du serveur** :
   - `403` / `410` → session expirée : ré-initialisez (`/init-stream`),
     ne bouclez pas sur le même `sessionId` ;
   - tout autre statut ≠ `206`/`200` → erreur définitive.
3. **2 tentatives supplémentaires maximum**, backoff 500 ms puis 1 s.
4. **Ré-émettez la même requête `Range` complète** et relisez
   `X-Counter-Start` / `X-Skip-Bytes` sur la réponse qui a réussi (ne
   réutilisez pas ceux d'une tentative interrompue).

Référence (TypeScript — identique au SDK) :

```ts
const RANGE_RETRIES = 2
const RANGE_RETRY_BASE_MS = 500

async function fetchStreamRange(workerUrl: string, sessionId: string, start: number, end: number) {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RANGE_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RANGE_RETRY_BASE_MS * attempt))
    try {
      const r = await fetch(`${workerUrl}/stream/${sessionId}`, {
        headers: { Range: `bytes=${start}-${end}` },
      })
      if (r.status === 403 || r.status === 410) throw new SessionExpiredError(r.status) // pas de retry
      if (r.status !== 206 && r.status !== 200) throw new StreamError(r.status)         // pas de retry
      const counterStart = Number(r.headers.get('X-Counter-Start'))
      const skipBytes = Number(r.headers.get('X-Skip-Bytes'))
      const cipher = new Uint8Array(await r.arrayBuffer()) // un corps coupé rejette ici → retry
      return { cipher, counterStart, skipBytes }
    } catch (e) {
      if (e instanceof SessionExpiredError || e instanceof StreamError) throw e
      lastErr = e
    }
  }
  throw lastErr
}
```

Équivalents natifs : mêmes règles avec `URLSession` (iOS) ou
OkHttp (Android) — retenter `IOException` / `URLError` réseau, jamais un
code HTTP.

## Rappel quotas

Les re-essais re-téléchargent des octets déjà comptés : c'est prévu, le
quota de session (multiplicateur ×3 sur la taille de piste) absorbe
largement 2 re-essais par range.
