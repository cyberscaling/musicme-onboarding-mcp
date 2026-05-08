# skill/

Claude Code / Cursor skill pour orchestrer l'intégration du streaming
audio musicme dans un site existant.

## Installation

### Claude Code (projet)

Copie le dossier `musicme-integration/` dans `<project>/.claude/skills/`:

```bash
mkdir -p .claude/skills
cp -R skill/musicme-integration .claude/skills/
```

### Claude Code (global)

```bash
mkdir -p ~/.claude/skills
cp -R skill/musicme-integration ~/.claude/skills/
```

### Cursor

Cursor lit également `.claude/skills/` dans le projet. Même procédure
qu'au-dessus.

### Vérification

Dans Claude Code, ouvre une session et tape `/musicme-integration`. Si
la skill est bien chargée, son contenu apparaît dans la complétion. Sinon,
relance le client agent.

## Usage

Une fois la skill installée + le MCP `musicme-onboarding` configuré:

1. Ouvre une session dans le repo cible.
2. Tape `/musicme-integration` (ou ouvre une question naturelle "j'aimerais
   intégrer le streaming musicme").
3. Suis les 6 prompts de [`prompts/integration-prompts.md`](../prompts/integration-prompts.md),
   un par un.

La skill définit un mode de réponse concis (`stream-mode`) actif pendant
toute la durée du flow.

## Mise à jour

Les versions de la skill sont alignées avec celles du MCP. Pour mettre à
jour:

```bash
git pull
cp -R skill/musicme-integration ~/.claude/skills/   # écrase l'ancien
```
