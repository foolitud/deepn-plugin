# Deepn pour Claude Code

Deepn fait des podcasts qui expliquent des sujets complexes. Ce plugin laisse votre Claude dire à Deepn qui vous êtes, pour que vos Épisodes partent de là où vous en êtes. Vous voyez chaque ligne avant qu'elle parte, et vous retirez ce que vous voulez.

## Installer et connecter

Dans Deepn, ouvrez Vous, puis Connect, et touchez « Ajouter à Claude ». Collez le texte qui en sort dans Claude Code, sur votre ordinateur : Claude installe ce plugin, puis vous demande d'ouvrir une nouvelle session et d'y taper `/deepn:connect` suivi de l'adresse de votre connecteur. Ça marche aussi dans l'onglet Code de l'appli Claude.

À la main :

```bash
claude plugin install deepn --marketplace foolitud/deepn-plugin
```

Il faut Claude Code 2.1.292 ou plus récent.

## Ce qui se passe

1. Claude lit ce que Claude Code garde sur vous, sur votre Mac.
2. Il vous montre trois listes : ce qui vous décrit en général, ce qui vous occupe en ce moment (daté, le plus récent d'abord), et ce qui est peut-être sensible.
3. Vous donnez les numéros à retirer, ou vous répondez ok. Tout le reste part, et s'affiche dans Deepn, où chaque ligne se retire.
4. Ensuite, au début d'une session et au plus une fois par semaine, Claude envoie seul ce qui est nouveau, hors des lignes peut-être sensibles, qui attendent votre prochain `/deepn:connect`.

Chaque passage se fait sur votre forfait Claude.

## Ce que Claude lit

`scripts/collect.mjs` choisit et plafonne, à environ 50 000 caractères : le `CLAUDE.md` global et ceux des projets les plus utilisés, les mémoires sur vous, les descriptions des mémoires de projet et de travail, et vos prompts longs des 30 derniers jours. Les adresses, téléphones, liens et ce qui ressemble à une clé sont masqués. Ce masquage repère des formes connues, et une clé peut y échapper.

Il ne lit jamais les transcripts, les contenus collés, les réglages, ni les mémoires `reference`, qui gardent les comptes et les identifiants.

## Ce qui reste sur votre Mac

Dans `~/.claude/plugins/data/` : le jeton de la connexion, qui ne sait qu'ajouter des lignes, les lignes refusées et la date du dernier envoi. Claude Code efface ce dossier quand vous désinstallez le plugin, mais ce qui est déjà chez Deepn y reste : « Tout effacer » se trouve dans l'appli, sous Connect.

## Développer

```bash
npm test
DEEPN_API_URL=http://localhost:8787 claude --plugin-dir .
```
