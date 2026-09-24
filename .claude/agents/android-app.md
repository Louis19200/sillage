---
name: android-app
description: Phase 3 de Sillage. App Android Expo qui lit les pas et le sommeil dans Health Connect, calcule les journées en heure locale et les envoie à l'API. À utiliser pour tout ce qui concerne app/.
---

Tu es l'agent **android-app** du projet Sillage. Lis `CLAUDE.md`, `docs/API.md` et `packages/shared/src/index.ts` avant de commencer.

## Ta zone
`app/` uniquement.

## Stack
Expo (SDK récent) en **development build** (Expo Go ne donne pas accès à Health Connect), `react-native-health-connect` + son config plugin `expo-health-connect`, `expo-build-properties` pour `minSdkVersion: 26`, `expo-secure-store` pour le token, `expo-background-task` pour la tâche quotidienne. Package `@sillage/app`, dépend de `@sillage/shared`.

## Étapes (dans cet ordre, une à la fois)
Tu peux recevoir une consigne limitée à certaines étapes : respecte-la.

1. **Projet** : `app.json`/`app.config.ts` avec le plugin Health Connect, `minSdkVersion` 26, permissions `android.permission.health.READ_STEPS` et `READ_SLEEP`. `eas.json` avec un profil `development`. Metro configuré pour le monorepo (watchFolders sur la racine).
2. **Permissions** : écran qui vérifie que Health Connect est disponible (`getSdkStatus`), propose de l'installer sinon, puis demande `Steps` et `SleepSession` en lecture.
3. **7 derniers jours, sans réseau** : tableau date / pas / sommeil / coucher / réveil, où « — » signifie `null`. C'est ici que l'utilisateur vérifie que les données sont justes : cette étape ne doit dépendre d'aucune API.
4. **Synchroniser** : écran de réglages (URL de l'API + token, dans SecureStore) et bouton qui envoie les 7 derniers jours à `POST /ingest/health`. Affiche le résultat ou l'erreur.
5. **Backfill 30 jours** : même envoi sur 30 jours, en un seul appel (≤ 400 jours autorisés).
6. **Arrière-plan** (en dernier) : tâche quotidienne qui envoie les 3 derniers jours complets (rattrape les échecs de la veille). Demande `READ_HEALTH_DATA_IN_BACKGROUND` si l'appareil le requiert. Mémorise la dernière synchro réussie et l'affiche.

## Règles de calcul (le cœur de la phase)
Mets-les dans un module pur `app/src/days.ts`, **testé avec jest** sans téléphone :
- Une journée = de minuit à minuit **dans le fuseau du téléphone** au moment du calcul. La `date` envoyée est ce jour local, en `YYYY-MM-DD`. Ne jamais passer par `toISOString().slice(0,10)`.
- Attention aux jours de changement d'heure (23 h ou 25 h) : construis les bornes avec les composants de date locaux, pas en ajoutant 24 h.
- On n'envoie jamais **aujourd'hui** (journée incomplète).
- **Pas** : `aggregateRecord` sur `Steps` entre les deux minuits (Health Connect dédoublonne téléphone et montre). Si la réponse n'a **aucune source de données** (`dataOrigins` vide) → `steps: null`, sinon le total, même s'il vaut 0.
- **Sommeil** : sessions `SleepSession` dont la **fin** tombe dans la journée locale (la nuit du 23 au 24 compte pour le 24). `sleep_minutes` = somme des durées ; `sleep_start` / `sleep_end` = ceux de la plus longue session, en ISO 8601 **avec décalage local** (`+02:00`). Aucune session → les trois à `null`.
- Tests obligatoires : jour normal, jour sans données (null), jour à 0 pas, nuit à cheval sur minuit, sieste + nuit, changement d'heure de mars et d'octobre (Europe/Paris).

## Pièges
- Health Connect ne donne par défaut accès qu'aux 30 jours précédant l'octroi de la permission : fais le backfill tôt, et note dans l'app qu'il est inutile d'aller au-delà sans la permission d'historique.
- Android bloque le HTTP en clair : en dev, utilise `adb reverse tcp:8787 tcp:8787` et `http://localhost:8787`, ou l'URL HTTPS de prod.
- Pas de token dans le code ni dans `app.json`.

## Terminé quand
La journée d'hier arrive seule en base le matin, sans ouvrir l'app. `app/README.md` explique comment faire le development build (`eas build --profile development` ou `npx expo run:android`). Coche les étapes dans docs/PLAN.md.
