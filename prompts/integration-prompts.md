# musicme — jeu de prompts pour l'intégration

Ce document propose **6 prompts** à exécuter dans l'ordre, dans Claude Code (ou
Cursor / autre client agent), pour intégrer le streaming audio musicme dans un
site existant. Chaque prompt est conçu pour une exécution **autonome** par
l'agent, avec des questions à l'utilisateur **uniquement** quand l'audit ne
peut pas conclure.

> **Pré-requis** : la skill `musicme-integration` est installée
> (voir `skill/musicme-integration/SKILL.md`). Elle définit le mode de
> réponse concis utilisé tout au long du flow.

> **Pré-requis** : le MCP `musicme-onboarding` est configuré dans le client
> agent avec `MUSICME_ONBOARDING_API_KEY` (clé fournie par l'opérateur
> musicme).

> **Référence technique** : le guide d'intégration complet est disponible à
> [`docs/integration-guide.md`](../docs/integration-guide.md) dans le présent
> repository (URL publique :
> https://github.com/cyberscaling/musicme-onboarding-mcp/blob/main/docs/integration-guide.md).
> Les prompts y renvoient quand un détail mérite vérification humaine.

---

## Vue d'ensemble du flow

| Phase | Prompt | Sortie attendue | Durée typique |
|---|---|---|---|
| 1 | **Audit** | Rapport structuré sur la stack, l'auth, le player | 2–5 min |
| 2 | **Clarification** | Questions à l'utilisateur (zéro si tout déduit) | 1–3 min |
| 3 | **Specs** | Liste de work-items + dépendances + plan de tests | 3–10 min |
| 4 | **Planning** | Test cases concrets + ordre d'exécution | 2–5 min |
| 5 | **Implémentation** | Code + tests verts à chaque étape | 30–120 min |
| 6 | **Documentation finale** | Runbook + plan de tests à valider par l'humain | 5–10 min |

À la fin : intégration fonctionnelle, plan de tests à dérouler par l'humain
pour valider en bout de chaîne, et documentation persistante.

---

## Prompt 1 — Audit

Copier-coller dans une session vierge de Claude Code, depuis la racine du
projet à intégrer.

```text
/musicme-integration

Phase 1: AUDIT.

Audite ce dépôt pour préparer l'intégration du streaming audio musicme.
Sortie en mode caveman (fragments OK, pas d'articles, pas de filler).

Points à couvrir, en parallèle quand possible (utilise des sous-agents
Explore pour les recherches indépendantes):

1. Stack: framework principal, langage backend, bundler frontend, runtime
   cible (Node/Bun/Deno/PHP/Edge/...), gestionnaire de paquets.
2. Auth: comment l'utilisateur final est identifié côté backend
   (session cookie, JWT, OAuth, magic-link, ...). Identifie l'identifiant
   utilisateur stable (UUID, email hash, id BDD) qui servira de `sub`
   JWT côté musicme.
3. Routing: pattern routes API + pages (App Router, Pages Router, Express
   middlewares, file-based routing, ...). Montre 2-3 exemples existants.
4. Player audio existant: y a-t-il déjà un <audio>, un wavesurfer, un
   howler.js, un MediaSession ? Où est-il monté ?
5. Catalogue: où viennent les `(cb, disc, track)` que le partenaire
   passera à musicme ? Existe-t-il une table tracks / un endpoint
   catalogue ? (Si oui, mappe les colonnes.)
6. Secrets: comment sont gérés les secrets backend (.env, Vault, AWS
   Secrets Manager, GCP Secret Manager, wrangler secret put, ...) ?
   Identifie l'endroit où poser MUSICME_MINT_KEY.
7. Origines frontend: liste les URLs depuis lesquelles le SPA tourne
   (prod, staging, dev local, preview deploys).
8. Déploiement: target (Vercel / Netlify / CF Workers / Heroku / VPS /
   K8s) + CI (GitHub Actions, GitLab CI).

Format de sortie:

## Audit

### Stack
- ...

### Auth
- ...
... (etc.)

### Bloqueurs détectés
- liste de gaps qui empêcheraient l'intégration (manque de player,
  pas de backend, etc.). Vide si tout va bien.

### Hypothèses à valider en phase 2
- liste de points où l'audit ne peut pas conclure et qui demanderont
  une question à l'humain.

Pas de code ici. Pas de modification de fichiers. Lecture seule.
```

---

## Prompt 2 — Clarification

À copier en bloc après le prompt 1, dans la même session.

```text
Phase 2: CLARIFICATION.

Reprends la liste "Hypothèses à valider en phase 2" de l'audit.

Pour chaque point de cette liste, pose UNE question claire à l'utilisateur
via le composant AskUserQuestion (max 4 questions par batch). Si une
hypothèse peut être tranchée par défaut raisonnable, fais-le sans demander
et indique-le simplement dans le récap.

Règles:
- Zéro question si tout est tranchable depuis l'audit.
- Pas de question redondante avec l'audit.
- Pas de question sur "veux-tu que je continue ?" — l'agent enchaîne.
- Pour chaque question, propose 2-4 options pertinentes, avec une option
  recommandée en première position.

Sujets possibles, à n'aborder QUE s'ils restent ouverts:

- Identifiant utilisateur à utiliser comme `sub` JWT (si plusieurs
  candidats: `users.id`, hash email, etc.).
- Source des `(cb, disc, track)` à transmettre au /init-stream:
  table existante, endpoint externe, hardcodé au début, ...
- Mode du player: 'mse' (recommandé, tout MP4) ou 'blob' (simple, tout
  télécharger d'abord).
- Stratégie de cache du JWT côté frontend (1 mint par morceau vs cache
  court).
- Origines à enregistrer (prod + staging + localhost dev).

Sortie après réponses:

## Décisions
- point 1: choix retenu + courte raison
- point 2: ...

Reste en mode caveman. Pas de filler entre les questions.
```

---

## Prompt 3 — Specs

```text
Phase 3: SPECS.

Génère le plan d'implémentation à partir des résultats de l'audit + des
décisions de la phase 2.

Format:

## Work items

| ID | Titre | Dépend de | Sous-agent ? | Durée |
|----|-------|-----------|--------------|-------|

Convention: WI-01, WI-02, ...

Items obligatoires (à ajuster selon la stack auditée):

- WI-01: ajouter MUSICME_MINT_KEY au gestionnaire de secrets (cible
  identifiée en phase 1)
- WI-02: créer route backend POST /api/player-token (auth-gated, mint
  via X-Mint-Key)
- WI-03: installer SDK `@cyberscaling/secure-audio-stream-client`
  (`bun add @cyberscaling/secure-audio-stream-client`, ou pnpm/npm/yarn).
  Le SDK est publié sur npm public, aucun token requis.
- WI-04: composant frontend SecureAudioPlayer (wrapper SDK)
- WI-05: brancher le composant au catalogue existant (selon source
  identifiée phase 1+2)
- WI-06: enregistrer le partenaire via le MCP musicme-onboarding
  (tool register_partner)
- WI-07: enregistrer toutes les origines (prod + staging + localhost dev)
  via update_allowed_origins
- WI-08: smoke tests E2E (cf phase 4)
- WI-09 (optionnel): page d'erreur dédiée pour
  onSessionExpired/onError du SDK

Pour CHAQUE work item, précise:

- fichiers créés/modifiés (chemins exacts)
- bibliothèques à installer
- contrat I/O (pour les routes backend: query, body, headers, response;
  pour les composants: props)
- critères d'acceptation (testables)
- sous-agent ? si parallélisable avec d'autres WI sans dépendance, oui
- estimation: en intervalle (5-15 min, 30-60 min, ...)

## Dépendances
ASCII DAG des WI.

## Risques & mitigations
- liste courte. Ex: "SDK npm pas trouvé → fallback fetch + Web Crypto
  manuel".

## Order d'exécution recommandé
Par phases pour exploiter le parallélisme.

Reste en mode caveman.
```

---

## Prompt 4 — Planning des tests

```text
Phase 4: TESTS.

Pour chaque WI de la phase 3, génère les tests qui valideront son
implémentation. Les tests doivent être exécutables de manière
**autonome** par un agent pendant l'implémentation: pas
d'interaction, sortie machine-lisible (codes de retour, JSON).

Niveaux de tests requis:

1. **Unitaires** (rapides, isolés, sans réseau): la logique pure
   (validation, mapping, hash, ...).
2. **Intégration** (avec réseau autorisé musicme uniquement, pas
   d'auth gateway tiers): /api/player-token côté backend appelle
   réellement /api/internal/mint sur staging musicme.
3. **E2E** (browser + audio): playwright / vitest browser pour
   charger un morceau réel et vérifier que <audio>.duration > 0
   après lecture de quelques secondes.

Format par WI:

### WI-XX
- pré-requis: WI-YY done
- tests:
  - [ ] WI-XX-T1: <description> | type: unit | fichier:
    `<path/to/test>` | commande: `<cmd>`
  - [ ] WI-XX-T2: ...

Spécifiez la commande exacte pour CHAQUE test (ex:
`bun test path/to/file.test.ts`, `pytest -k test_xxx`,
`npx playwright test e2e/xxx.spec.ts --grep "xxx"`).

Identifiez aussi:
- les **smoke tests E2E finaux** qui valident l'intégration end-to-end
  (login → token → init-stream → audio joue 3 secondes au moins).
- les **fixtures** nécessaires (un (cb, disc, track) connu pour les
  tests; demander à l'opérateur musicme si pas disponible — par
  défaut: cb=5400863209100, disc=1, track=1 pour le catalogue de
  démo).

Reste en mode caveman.
```

---

## Prompt 5 — Implémentation

```text
Phase 5: IMPLEMENTATION.

Implémente les WI de la phase 3 dans l'ordre de la phase 3.

Règles d'exécution:

1. Avant chaque WI: rappelle son ID + titre. Une ligne.
2. Implémente. Code en style natif du projet (existant style).
3. Lance les tests de la phase 4 pour ce WI dès que possible.
   - Si rouge: corrige autonome (max 3 tentatives) avant de demander.
   - Si vert: cocher la case dans le plan, passer au suivant.
4. WI parallélisables (marqués "Sous-agent: oui" en phase 3): lance
   en parallèle via le tool Agent avec subagent_type=general-purpose,
   chacun avec un brief autonome (assumer aucun contexte).
5. Pas de commit git automatique. L'humain commit à la fin selon ses
   conventions.

Hooks de progression (output bref):
- "[WI-XX] start"
- "[WI-XX] tests: 3/3 ✓" ou "[WI-XX] tests: 2/3 retry 1"
- "[WI-XX] done" ou "[WI-XX] BLOCKED: <raison brève>"

Si un WI échoue après 3 tentatives:
- résume le blocage en 3 lignes max
- propose 2-3 pistes de fix
- attends instruction utilisateur

Smoke E2E final (de la phase 4) lancé en dernier. Le flow s'arrête
si rouge.

Reste en mode caveman pour les hooks. Code écrit en style natif (pas
de caveman dans les fichiers source).
```

---

## Prompt 6 — Documentation finale

```text
Phase 6: DOCUMENTATION FINALE.

Une fois la phase 5 terminée (smoke E2E vert), produis:

### A. Runbook d'opération

Fichier: `docs/musicme-runbook.md` (ou équivalent dans la convention
du projet).

Sections:
1. Vue d'ensemble (5 lignes max).
2. Variables d'environnement (avec descriptions).
3. Comment lancer en dev local + comment vérifier que ça marche.
4. Comment déployer (CI/CD du projet).
5. Comment rotater le MINT_KEY (procédure côté musicme + côté nous).
6. Liens: doc partenaire musicme, repo MCP, contact opérateur.

### B. Plan de tests utilisateur

Fichier: `docs/musicme-test-plan.md`.

Liste des tests à dérouler MANUELLEMENT par un humain (toi, l'humain).
Chaque test:

- ID
- Description courte
- Étapes (numérotées)
- Résultat attendu
- Comment "valider" (case à cocher après dérroulement réussi)

Couvre:
- T1: Login utilisateur normal → page lecteur
- T2: Play d'un morceau → audio joue, currentTime > 0 après 5s
- T3: Pause / reprise → currentTime cohérent
- T4: Changement de morceau → nouveau morceau joue, ancien arrêté
- T5: Logout → tentative de play → 401 ou bloc affiché (selon
  comportement attendu)
- T6: Origine non autorisée → bloqué (test depuis un browser
  pointant sur un domaine non listé dans allowed_origins)
- T7: Session > 5 min → 410 et auto-reload (comportement SDK)

Pour chaque test, précise comment l'exécuter dans la stack du projet
(URL, comptes, données de test).

### C. Mise à jour du README projet

Si le projet a un README:
- ajouter une section "Audio streaming musicme"
- pointer vers le runbook
- pointer vers le plan de tests
- mentionner les variables d'env requises

Sortie en mode caveman pour les commentaires sur l'avancement.
Documentation finale en français lisible (pas de caveman dans les
fichiers livrés).
```

---

## Annexe — comment chaîner

Le bon chaînage est:

```
Prompt 1 ─────► (audit)
              │
              ▼
Prompt 2 ─────► (clarif, optional questions to human)
              │
              ▼
Prompt 3 ─────► (specs)
              │
              ▼
Prompt 4 ─────► (tests)
              │
              ▼
Prompt 5 ─────► (impl + tests autonomes)
              │
              ▼
Prompt 6 ─────► (docs + plan tests humain)
```

Si tu utilises Claude Code: ouvre la session avec `/musicme-integration`
(la skill) et colle les prompts un par un dans l'ordre.

Si l'agent diverge ou rate quelque chose en cours de route, tu peux
toujours re-coller le prompt de la phase concernée pour reprendre depuis
ce point.
