# app/ : Sillage sur Android

App Expo (Android uniquement) qui lit les **pas** et le **sommeil** dans Health Connect et
calcule les journées en heure locale sur le téléphone. Zone de l'agent `android-app`
(phase 3, voir `.claude/agents/android-app.md`).

État actuel : étapes 1 à 6. L'app demande l'accès à Health Connect, affiche les
7 dernières journées complètes **sans aucun appel réseau**, puis, sous le tableau, envoie
ces 7 jours (« Synchroniser ») ou 30 jours (« Backfill 30 jours ») à `POST /ingest/health`.
Depuis l'étape 6, une tâche de fond envoie chaque matin les 3 dernières journées complètes,
et l'app rattrape à l'ouverture si la tâche n'a pas pu passer (voir « Synchro automatique »).

> **Reconstruire l'APK (étape 6).** L'étape 6 ajoute du code natif (`expo-background-task`,
> `expo-task-manager`, le module local `modules/sillage-device`) et une permission
> (`READ_HEALTH_DATA_IN_BACKGROUND`). Un APK construit avant ne les contient pas : relance
> `npx eas-cli@latest build --profile preview --platform android` et réinstalle par-dessus
> (les réglages et le token sont conservés).

## Organisation

| Fichier | Rôle |
|---|---|
| `src/days.ts` | Cœur de la phase : bornes des journées locales, pas, sommeil. Module pur, testé avec jest. |
| `src/healthConnect.ts` | Seul fichier qui appelle Health Connect (disponibilité, permissions, lecteur réel). |
| `src/format.ts` | Affichage (« — » = `null`). |
| `src/screens/PermissionsScreen.tsx` | Étape 2 : Health Connect présent ? Sinon, l'installer. Puis lecture Steps + SleepSession. |
| `src/screens/DaysScreen.tsx` | Étape 3 : tableau date / pas / sommeil / coucher / réveil. |
| `src/api.ts` | Étape 4 : client de `POST /ingest/health`, `fetch` injecté. Valide le corps (`HealthIngestBody`) et la réponse (`IngestResult`), gère 400, 401, autres statuts, réseau coupé, délai (20 s). Le token n'est jamais loggué ni recopié dans un message. |
| `src/sync.ts` | Étapes 4 à 6 : `runSync("sync" \| "backfill" \| "background" \| "open", deps)` calcule 7, 30 ou 3 jours, n'envoie que les valeurs présentes, en **un seul appel**, et mémorise le résultat. Tout est injecté, testé avec jest. |
| `src/background.ts` | Étape 6, module pur : faut-il synchroniser (`needsDailySync`, `shouldSyncOnOpen`), corps de la tâche de fond (`runBackgroundTask`, ne lève jamais), texte d'état (`describeAutoSync`). Testé avec jest. |
| `src/backgroundTask.ts` | Étape 6, câblage : `TaskManager.defineTask` (importé par `index.ts` avant tout), enregistrement WorkManager toutes les 3 h environ. |
| `modules/sillage-device/` | Module natif local (Kotlin, lecture seule) : disponibilité de la lecture en arrière-plan dans Health Connect (`getFeatureStatus`), optimisation et restriction de batterie. Absent de l'APK → « inconnu », sans planter. |
| `src/settings.ts` | Câblage réel : URL, token et dernière synchro dans `expo-secure-store`. |
| `src/screens/SettingsScreen.tsx` | URL de l'API et `INGEST_TOKEN` (masqué, jamais réaffiché). |
| `src/screens/SyncPanel.tsx` | Boutons « Synchroniser (7 jours) » et « Backfill 30 jours », dernière tentative et dernière réussite ; état de la synchro automatique, dernier passage en arrière-plan, repli à l'ouverture. |
| `scripts/check-api.ts` | Envoie 30 journées produites par un faux Health Connect à une vraie API et les relit. |
| `app.json` | Plugins Health Connect et `expo-background-task`, `minSdkVersion` 26, permissions `READ_STEPS`, `READ_SLEEP` et `READ_HEALTH_DATA_IN_BACKGROUND`. |
| `eas.json` | Profils `development` (client de développement) et `preview` (APK autonome, usage quotidien). |
| `metro.config.js` | Monorepo : surveille la racine, résout les modules depuis `app/` puis la racine. |

La lecture Health Connect est injectée dans `computeHealthDays(reader, dates)` : les tests
utilisent un faux lecteur, l'app utilise `healthConnectReader`.

## Règles de calcul (résumé)

- Une journée va de minuit à minuit **dans le fuseau du téléphone**. Les bornes sont
  construites avec `new Date(année, mois, jour)` et `jour + 1`, donc un jour de changement
  d'heure dure bien 23 h (mars) ou 25 h (octobre).
- `date` = jour local `YYYY-MM-DD`. Jamais `toISOString().slice(0, 10)`.
- Aujourd'hui n'est jamais calculé ni envoyé.
- **Pas** : agrégat `Steps` entre les deux minuits (Health Connect dédoublonne téléphone et
  montre). Aucune source (`dataOrigins` vide) → `null` ; sinon le total, même 0.
- **Sommeil** : sessions dont la **fin** tombe dans la journée (la nuit du 23 au 24 compte
  pour le 24). `sleep_minutes` = somme des durées (sieste + nuit) ; si deux sources
  enregistrent la même nuit, le recouvrement n'est compté qu'une fois. Coucher et réveil =
  ceux de la plus longue session, avec le décalage local (`+02:00`). Aucune session → `null`.

## Commandes (développement)

Tu n'en as **pas besoin** pour installer l'app sur ton téléphone : elles servent à vérifier le code. Pour l'installation, va directement à la section du development build ci-dessous.

```bash
pnpm install                              # à la racine du dépôt
pnpm --filter @sillage/app test           # jest, avec TZ=Europe/Paris (obligatoire, vérifié au démarrage)
pnpm --filter @sillage/app typecheck
pnpm --filter @sillage/app expo-config    # config Expo résolue (plugins, permissions)
```

Client de synchro contre une API **locale** (sans téléphone ; voir api/README.md pour la démarrer). Il écrit 30 journées **factices** et refuse toute autre adresse que `localhost` :

```bash
SILLAGE_API_URL=http://localhost:8787 INGEST_TOKEN=... pnpm --filter @sillage/app check-api
```

```powershell
# même chose sous Windows (PowerShell)
$env:SILLAGE_API_URL = "http://localhost:8787"; $env:INGEST_TOKEN = "..."; pnpm --filter @sillage/app check-api
```

Pour vérifier l'API de production **sans rien écrire** : `node api/scripts/check-prod.mjs` (voir docs/DEPLOY.md).

## Juste installer l'app pour l'utiliser au quotidien (recommandé)

Si tu ne comptes pas modifier le code, construis l'APK **autonome** (profil `preview`) : le
JavaScript est embarqué dans l'app, qui fonctionne donc **sans ton ordinateur**. C'est aussi
ce qu'il faut pour la synchronisation automatique du matin (étape 6).

Sous Windows (PowerShell), depuis la racine du dépôt :

```powershell
npx pnpm@10.33.0 install
cd app
npx eas-cli@latest login      # compte gratuit sur https://expo.dev/signup
npx eas-cli@latest init       # une seule fois ; commite le changement d'app.json
npx eas-cli@latest build --profile preview --platform android
```

Compte 10 à 20 minutes. À la fin : un lien et un QR code → télécharge l'APK sur le téléphone
et installe-le (autorise l'installation depuis le navigateur, puis « Installer quand même » si
Play Protect avertit). Suis ensuite les étapes « Préparer le téléphone » plus bas pour Health Connect.

À chaque changement de l'app, relance la même commande `build` et réinstalle l'APK par-dessus
(les réglages et le token sont conservés).

Le **development build** décrit ci-dessous sert à développer : il charge le code depuis ton
ordinateur (`pnpm start` doit tourner) et affiche les modifications instantanément.

## Pourquoi un « development build » (et pas Expo Go)

Expo Go est une app générique : elle ne contient pas le code natif de Health Connect et ne
peut pas déclarer les permissions `android.permission.health.*`. Il faut donc construire
**notre propre APK**, qui embarque ce code natif et le client de développement Expo. Une fois
installé, il se comporte comme Expo Go : il charge le JavaScript depuis ton ordinateur, et
chaque modification de code s'affiche sans reconstruire l'APK. On ne reconstruit que si l'on
change `app.json`, un plugin ou une dépendance native.

Deux façons de construire l'APK. **La A est la plus simple** : rien à installer côté Android,
la compilation se fait sur les serveurs d'Expo.

---

## A. Construire dans le cloud avec EAS (recommandé)

### 1. Préparer le téléphone (une seule fois)

1. Vérifie qu'Android est en version 8 ou plus (Paramètres → À propos du téléphone).
2. Sur Android 13 ou moins, installe **Health Connect** depuis le Play Store (sur Android 14
   et plus, il est intégré au système). L'app te le proposera de toute façon.

### 2. Créer un compte Expo et se connecter (une seule fois)

1. Crée un compte gratuit sur <https://expo.dev/signup>.
2. Sur ton ordinateur, depuis la racine du dépôt :
   ```bash
   pnpm install
   cd app
   npx eas-cli@latest login          # identifiants du compte Expo
   npx eas-cli@latest init           # crée le projet sur expo.dev
   ```
   `eas init` ajoute `extra.eas.projectId` (et `owner`) dans `app.json`. Ce n'est **pas** un
   secret : commite ce changement.

### 3. Lancer la compilation

```bash
cd app
npx eas-cli@latest build --profile development --platform android
```

- Réponds « oui » s'il propose de générer un keystore Android (il le garde pour toi).
- EAS envoie tout le monorepo (il voit `pnpm-lock.yaml` et `.npmrc` à la racine), installe
  les dépendances et compile. Compte 10 à 20 minutes (file d'attente gratuite comprise).
- À la fin, il affiche un **lien** et un **QR code**.

### 4. Installer l'APK sur le téléphone

1. Scanne le QR code avec l'appareil photo du téléphone (ou ouvre le lien dans son
   navigateur) et télécharge l'APK.
2. Ouvre le fichier téléchargé. Android demande d'**autoriser l'installation d'applications
   inconnues** pour le navigateur : accepte, puis reviens et installe.
3. Play Protect peut avertir que l'app est inconnue : « Installer quand même ».

### 5. Lancer le serveur de développement et ouvrir l'app

Sur l'ordinateur :

```bash
cd app
pnpm start                     # = expo start --dev-client
```

Un QR code s'affiche dans le terminal. Sur le téléphone, ouvre **Sillage** (pas Expo Go) :

- Si le téléphone et l'ordinateur sont sur le **même Wi-Fi**, le serveur apparaît dans la
  liste de l'app, ou scanne le QR code du terminal.
- Sinon, branche le téléphone en USB (voir « Débogage USB » plus bas), puis :
  ```bash
  adb reverse tcp:8081 tcp:8081
  ```
  et, dans Sillage, saisis l'URL `http://localhost:8081`.

---

## B. Construire en local avec `expo run:android`

Plus rapide une fois installé, mais demande l'outillage Android sur l'ordinateur.

1. Installe **Android Studio** (<https://developer.android.com/studio>). Au premier lancement,
   laisse-le installer le SDK Android, puis dans *SDK Manager* coche **Android SDK Platform 36**
   et **Android SDK Build-Tools**.
2. Installe un **JDK 17** (Android Studio en fournit un ; sinon Temurin 17).
3. Déclare les variables d'environnement (macOS/Linux, dans `~/.zshrc` ou `~/.bashrc`) :
   ```bash
   export ANDROID_HOME="$HOME/Android/Sdk"          # macOS : $HOME/Library/Android/sdk
   export PATH="$PATH:$ANDROID_HOME/platform-tools"
   ```
   Sous Windows : *Paramètres système → Variables d'environnement*, `ANDROID_HOME` =
   `%LOCALAPPDATA%\Android\Sdk`, et ajoute `%ANDROID_HOME%\platform-tools` au `Path`.
4. Active le **débogage USB** (voir ci-dessous) et branche le téléphone. `adb devices` doit
   afficher une ligne se terminant par `device`.
5. Compile, installe et démarre :
   ```bash
   cd app
   npx expo run:android
   ```
   La première fois, cela génère le dossier `android/` (ignoré par git : il est recréé à
   partir de `app.json`), télécharge Gradle et compile (5 à 15 minutes). Les fois suivantes,
   `pnpm start` suffit tant qu'on ne touche pas au natif.

### Débogage USB

1. Paramètres → À propos du téléphone → touche 7 fois **Numéro de build** (« Vous êtes
   développeur »).
2. Paramètres → Système → **Options pour les développeurs** → active **Débogage USB**.
3. Branche le câble et accepte la fenêtre « Autoriser le débogage USB » sur le téléphone.

---

## Vérifier les données sur le téléphone (étape 3)

1. Ouvre Sillage : l'écran « Accès à Health Connect » s'affiche. Touche **Autoriser la
   lecture** et coche **Pas** et **Sommeil** dans la fenêtre de Health Connect.
2. Le tableau des 7 derniers jours apparaît (le plus récent en haut, aujourd'hui exclu).
3. Compare avec Health Connect (Paramètres → Health Connect → Données et accès → Activité →
   Pas, puis Sommeil) ou avec l'app qui produit les données (Fit, Samsung Health…) :
   - les **pas** d'une journée doivent correspondre au total de minuit à minuit ;
   - une journée sans montre ni téléphone porté doit afficher « — », pas 0 ;
   - la nuit du lundi au mardi doit apparaître sur la ligne du **mardi**, avec l'heure de
     coucher de lundi soir et l'heure de réveil de mardi matin ;
   - un jour avec sieste : la durée additionne sieste et nuit, les heures sont celles de la nuit.
4. Le fuseau affiché en haut doit être le tien (`Europe/Paris`).

## Synchroniser avec l'API (étapes 4 et 5)

### Quelle URL saisir ?

- **Production** : l'URL HTTPS de Vercel, `https://<projet>.vercel.app` (sans `/` final ;
  l'app l'enlève de toute façon).
- **Développement, API sur l'ordinateur** : branche le téléphone en USB, puis
  ```bash
  pnpm --filter @sillage/api dev      # voir api/README.md (base, INGEST_TOKEN)
  adb reverse tcp:8787 tcp:8787       # le port 8787 du téléphone mène à l'ordinateur
  ```
  et saisis `http://localhost:8787`. Le HTTP en clair n'est toléré que par le development
  build (`usesCleartextTraffic` en debug) ; un APK de production exige HTTPS.

Le token est la valeur d'`INGEST_TOKEN` de l'API. Il est stocké chiffré sur le téléphone
(`expo-secure-store`, Keystore Android, exclu des sauvegardes automatiques par le plugin),
n'est jamais réaffiché, jamais loggué, et n'est dans aucun fichier du dépôt.

### Sur le téléphone

1. Reconstruis et réinstalle le development build (voir l'encadré en haut).
2. Tableau des 7 jours → **Réglages (URL, token)** : saisis l'URL et colle le token,
   **Enregistrer**, puis **Retour**.
3. **Synchroniser (7 jours)** : attendu « Réussie : 7 journées enregistrées. », avec la
   période envoyée (d'il y a 7 jours à hier). Vérifie côté API :
   `curl <url>/range?from=<J-7>&to=<hier>` (ajouter l'en-tête `Authorization` si les
   lectures sont protégées) : mêmes pas, même sommeil que le tableau, « — » devenu `null`.
4. **Backfill 30 jours** : un seul appel, « 30 journées enregistrées ». Le refaire ne crée
   pas de doublon (upsert sur `date`).
5. Cas d'erreur à essayer : mauvais token → « Token refusé (401) » ; mode avion → « API
   injoignable » ; URL d'un autre site → « Réponse inattendue ». La dernière tentative et la
   dernière réussite restent affichées après avoir fermé l'app.

Health Connect ne donne accès qu'aux **30 jours précédant l'octroi de la permission**.
Au-delà, il faudrait la permission d'historique (`READ_HEALTH_DATA_HISTORY`) : inutile de
demander plus de 30 jours sans elle.

## Synchro automatique (étape 6)

### Ce qui se passe

- Une **tâche de fond** (expo-background-task, donc WorkManager) se réveille environ toutes
  les 3 h, seulement quand Sillage n'est pas à l'écran et que le téléphone a du réseau. Elle
  n'envoie qu'**une fois par jour**, au premier réveil après **5 h** : les 3 dernières journées
  complètes (hier, plus deux jours pour rattraper un échec). Les autres réveils de la journée
  notent « rien à envoyer ». Une synchro faite avant 5 h est refaite après, pour prendre les
  données arrivées en retard de la montre.
- **Repli à l'ouverture** : si hier n'a pas encore été envoyé quand tu ouvres Sillage (tâche
  bloquée, tuée par Samsung, permission refusée…), l'app envoie les 3 jours tout de suite
  (« auto à l'ouverture » dans la dernière tentative). Jamais sans URL ni token, et pas plus
  d'une tentative ratée toutes les 30 min.
- Comme les autres synchros, seules les valeurs présentes sont envoyées ; si Health Connect ne
  renvoie rien, rien n'est envoyé (et rien n'est effacé en base).
- Le panneau « Synchro automatique » (sous les boutons) dit ce qui est vraiment en place :
  « activée, en arrière-plan », ou « à l'ouverture de l'app seulement » avec la raison. Il
  affiche aussi le **dernier passage en arrière-plan** (heure, « envoi réussi », « échec » ou
  « rien à envoyer »). Le bouton « Diagnostic Health Connect » ajoute les mêmes informations
  (fonctionnalité, permission, batterie, tâche).

### Lecture de Health Connect en arrière-plan (Android 12)

Sans la permission `READ_HEALTH_DATA_IN_BACKGROUND`, une lecture faite par la tâche de fond ne
renvoie que les données écrites par Sillage lui-même (donc rien), voire lève une erreur : la
tâche noterait alors un échec et le repli à l'ouverture prendrait le relais.

Sur Android 13 et moins, Health Connect est l'appli du Play Store : la lecture en arrière-plan
y est disponible si cette appli est **assez récente** (fonctionnalité
`FEATURE_READ_HEALTH_DATA_IN_BACKGROUND`, version 171302 ou plus, largement dépassée par une
appli à jour). Le module `modules/sillage-device` le vérifie ; l'écran affiche
« indisponible dans cette version de Health Connect » sinon : mets-la à jour depuis le Play Store.

### Ce que tu dois faire après avoir réinstallé l'APK

1. **Reconstruire** le profil `preview` et réinstaller par-dessus (encadré en haut).
2. Ouvre Sillage. Dans « Synchro automatique », touche **Autoriser la lecture en
   arrière-plan** : la fenêtre Health Connect s'ouvre avec Pas, Sommeil et l'accès en
   arrière-plan ; active ce dernier. Le panneau doit passer à « activée, en arrière-plan ».
   (Plus tard : Health Connect → Autorisations des applis → Sillage.)
3. **Batterie (Samsung, One UI 4)** : Samsung tue souvent les tâches de fond.
   - Paramètres → Applications → **Sillage** → **Batterie** → choisis **« Non restreinte »**
     (selon la traduction : « Sans restriction » ; en tout cas pas « Optimisée » ni
     « Restreinte »). Le bouton « Ouvrir les réglages de Sillage » du panneau mène à l'écran
     Applications → Sillage.
   - Paramètres → **Batterie et maintenance de l'appareil** → **Batterie** → **Limites
     d'utilisation en arrière-plan** → **Applications jamais en veille** → **+** → Sillage.
     Vérifie aussi que Sillage n'est ni dans « Applications en veille » ni dans
     « Applications en veille prolongée ».
4. Ferme Sillage (bouton accueil, pas besoin de la tuer) et attends le **lendemain matin**. Le
   premier réveil a lieu au plus tôt 3 h après la première ouverture.
5. Le lendemain, **avant d'ouvrir Sillage** (sinon le repli à l'ouverture fausse le test),
   vérifie que la veille est en base :
   `curl -H "Authorization: Bearer <READ_TOKEN>" "<url>/range?from=<hier>&to=<hier>"`.
   Puis ouvre Sillage : « Dernier passage en arrière-plan » doit dire « envoi réussi » vers
   5–8 h, et la dernière tentative « arrière-plan ».

Si le dernier passage dit « jamais » après une nuit, Android ne lance pas la tâche (batterie,
veille) ; s'il dit « échec » avec « n'est pas autorisée », c'est la permission du point 2.
Dans les deux cas, ouvrir Sillage envoie quand même hier.

Pour forcer un passage sans attendre (téléphone en USB, débogage activé, Sillage fermée) :

```bash
adb shell dumpsys jobscheduler | grep -A2 "app.sillage"    # repère le numéro du job (#u0a…/NN)
adb shell cmd jobscheduler run -f app.sillage NN
```

## pnpm et Expo

Le dépôt utilise `node-linker=hoisted` (`.npmrc` à la racine) : les dépendances sont
installées à plat dans `node_modules/` à la racine, comme avec npm, ce dont Metro, Gradle et
l'autolinking d'Expo ont besoin (ils gèrent mal les liens symboliques du mode par défaut de
pnpm). Avec ce réglage, `pnpm install` fonctionne tel quel : aucun contournement n'a été
nécessaire dans `app/`. `metro.config.js` ajoute simplement la racine du dépôt à
`watchFolders` et aux chemins de résolution, pour voir `packages/shared`.

`expo-health-connect` (cité dans la fiche de l'agent) n'est **pas** installé : il est
déprécié depuis `react-native-health-connect` v4, qui embarque son propre plugin Expo. Les
installer ensemble casse la compilation Android (classe `HealthConnectPackage` en double).
Le plugin s'écrit donc `"react-native-health-connect"` dans `app.json`.
