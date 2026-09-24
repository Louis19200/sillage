# app/ : Sillage sur Android

App Expo (Android uniquement) qui lit les **pas** et le **sommeil** dans Health Connect et
calcule les journées en heure locale sur le téléphone. Zone de l'agent `android-app`
(phase 3, voir `.claude/agents/android-app.md`).

État actuel : étapes 1 à 3. L'app demande l'accès à Health Connect puis affiche les
7 dernières journées complètes, **sans aucun appel réseau**. La synchro vers l'API
(étapes 4 et 5) et la tâche quotidienne (étape 6) viendront ensuite.

## Organisation

| Fichier | Rôle |
|---|---|
| `src/days.ts` | Cœur de la phase : bornes des journées locales, pas, sommeil. Module pur, testé avec jest. |
| `src/healthConnect.ts` | Seul fichier qui appelle Health Connect (disponibilité, permissions, lecteur réel). |
| `src/format.ts` | Affichage (« — » = `null`). |
| `src/screens/PermissionsScreen.tsx` | Étape 2 : Health Connect présent ? Sinon, l'installer. Puis lecture Steps + SleepSession. |
| `src/screens/DaysScreen.tsx` | Étape 3 : tableau date / pas / sommeil / coucher / réveil. |
| `app.json` | Plugin Health Connect, `minSdkVersion` 26, permissions `READ_STEPS` et `READ_SLEEP`. |
| `eas.json` | Profil `development` (APK avec le client de développement). |
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

## Commandes

```bash
pnpm install                        # à la racine du dépôt
pnpm --filter @sillage/app test     # jest, avec TZ=Europe/Paris (obligatoire, vérifié au démarrage)
pnpm --filter @sillage/app typecheck
pnpm --filter @sillage/app config   # config Expo résolue (plugins, permissions)
```

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

Health Connect ne donne accès qu'aux **30 jours précédant l'octroi de la permission**.
Au-delà, il faudrait la permission d'historique (`READ_HEALTH_DATA_HISTORY`) : inutile de
demander plus de 30 jours sans elle.

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
