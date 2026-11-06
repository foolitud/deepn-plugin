# deepn-plugin

Le plugin Claude Code qui dit à Deepn qui est la personne, pour que ses Épisodes partent de là où elle en est ([ADR 0017](../../docs/adr/0017-deepn-le-claude-de-la-personne-ecrit-dans-deepn.md)).

## Ce qui se passe

1. Dans Deepn, sous Vous puis Connect, la personne touche « Obtenir un code ».
2. Dans Claude Code, elle lance `/deepn:connect` avec ce code. Claude dit une phrase, lit ce que Claude Code garde sur elle et lui montre deux listes : l'essentiel, et ce qui est peut-être sensible.
3. Elle donne les numéros à retirer, ou répond ok. Tout le reste part, et s'affiche dans Deepn, où chaque ligne se retire.
4. Ensuite, au début d'une session et au plus une fois par semaine, un Claude sans personne devant l'écran envoie ce qui est nouveau dans l'essentiel. Les lignes peut-être sensibles attendent le prochain `/deepn:connect`.

## Ce que Claude lit

`scripts/collect.mjs` choisit et plafonne, à environ 50 000 caractères : le `CLAUDE.md` global et ceux des projets les plus utilisés, les mémoires sur la personne, les descriptions des mémoires de projet et de travail, et ses prompts longs des 30 derniers jours, avec adresses, téléphones, liens et ce qui ressemble à une clé masqués. Ce masquage repère des formes connues, et une clé peut y échapper.

Tout y porte son jour, et ce qui est récent passe en premier : les dernières questions et demandes en entier, puis un échantillon du reste du mois. Claude date chaque ligne du dernier jour où il la voit.

Il ne lit jamais les transcripts, les contenus collés, les réglages, ni les mémoires `reference`, qui gardent les comptes et les identifiants.

## Essayer

Sans installer, avec l'API locale de `deepn-api` :

```bash
DEEPN_API_URL=http://localhost:8787 claude --plugin-dir apps/deepn-plugin
```

Pour l'installer, depuis la racine du repo :

```bash
claude plugin marketplace add ./apps/deepn-plugin
claude plugin install deepn@deepn
```

Le repo est privé : pour que d'autres l'installent, le plugin devra vivre dans un repo public.

## Tester

```bash
pnpm --filter deepn-plugin test
```

## Où sont ses affaires

Dans `~/.claude/plugins/data/` : le jeton de la connexion, les lignes refusées et la date du dernier envoi. Claude Code efface ce dossier à la désinstallation, mais ce qui est déjà chez Deepn y reste : « Tout effacer » se trouve dans l'appli, sous Connect.
