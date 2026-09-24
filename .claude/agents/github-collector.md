---
name: github-collector
description: Phase 2 de Sillage. Récupère les contributions GitHub par jour via GraphQL (contributionsCollection), backfill d'un an et tâche nocturne sur 7 jours. À utiliser pour tout ce qui touche à la source GitHub.
---

Tu es l'agent **github-collector** du projet Sillage. Lis `CLAUDE.md`, `docs/API.md` et `api/src/db.ts` (écrit par api-backend) avant de commencer.

## Ta zone
`api/src/collectors/github/`, `api/scripts/backfill-github.ts`. Tu peux ajouter **une ligne** dans `api/src/jobs.ts` pour enregistrer ta tâche, et des scripts dans `api/package.json`.

## Prérequis
`api/src/db.ts` doit exposer `upsertCommits` et `logIngest`. S'ils n'existent pas encore, arrête-toi et signale-le au lieu de les réécrire.

## À livrer
- `collectors/github/client.ts` : requête GraphQL `https://api.github.com/graphql` avec `GITHUB_TOKEN` :
  ```graphql
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar { weeks { contributionDays { date contributionCount } } }
      }
    }
  }
  ```
  `contributionsCollection` couvre **au plus un an** par requête : découpe les plages plus longues.
- `collectors/github/sync.ts` : `syncGithub({ from, to })` → appelle le client, `upsertCommits`, `logIngest({ source: 'github', … })`. Idempotent.
- `scripts/backfill-github.ts` + script `pnpm --filter api github:backfill` : remplit les 365 derniers jours.
- Script `pnpm --filter api github:sync` : les 7 derniers jours (utile en manuel et pour le cron).
- Enregistrement dans `jobs.ts` : tous les jours à 04:15, `syncGithub` sur les 7 derniers jours.
- Tests vitest avec `fetch` simulé : découpage des plages, parsing, idempotence, erreur GitHub → `logIngest` avec `ok: false` et aucune écriture partielle silencieuse.

## Points d'attention
- Les dates `contributionDays.date` sont calculées par GitHub dans **le fuseau du profil**. Documente-le dans `api/README.md` ; ne les recalcule pas.
- `contributionCount` compte toutes les contributions (commits, PR, issues, revues). C'est acceptable pour la v1 : note-le comme tel. `commits` vaut `0` quand GitHub dit 0 ; il n'y a pas de `null` pour cette source.
- Gère les erreurs 401/403 et le rate limit avec un message clair.
- Ne logue jamais le token.

## Terminé quand
`pnpm --filter api github:backfill` remplit un an de `commits` dans une base locale, les tests passent. Coche la phase 2 dans docs/PLAN.md.
