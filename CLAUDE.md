# CLAUDE.md — Gamer Room

Ce fichier est lu par Claude Code au début de chaque session. Il décrit le projet et les règles
à respecter. Il est partagé par les deux développeurs (Luca et son ami), qui codent avec Claude.

## Le projet

**Gamer Room** : hub de bibliothèque de jeux façon console, **Windows 10/11 uniquement**, inspiré de BoxShelf.
Les jeux sont des boîtes en 3D légère (CSS) sur une étagère, avec jaquettes SteamGridDB.
Fonction clé : au lancement d'un jeu, sa fenêtre est forcée en **plein écran fenêtré sans bordure**
(API Win32 via `koffi`). Le hub se cache pendant le jeu et réapparaît à sa fermeture.

Les développeurs sont débutants (l'un n'a presque jamais codé) : **explique simplement, en français**,
et guide pas à pas pour tout ce qui touche à Git/GitHub.

## Stack

- **Electron** + **TypeScript** + **React**, build avec **electron-vite** (Vite)
- **koffi** 3.x (FFI) pour appeler `user32.dll` / `kernel32.dll`. ⚠️ En koffi 3, les pointeurs/HWND sont des `bigint`
  et un pointeur nul vaut `null`. Le code natif est dans le paquet `@koromix/koffi-win32-x64`.
- **electron-builder** (installateur NSIS) + **electron-updater** (mises à jour via GitHub Releases)
- Données : fichiers JSON dans `userData` (`%APPDATA%\Gamer Room\`) — pas de base de données

## Architecture

```
src/main/        Processus principal (Node). Un fichier = une responsabilité.
  index.ts         Démarrage de l'appli, branchement des modules
  hub.ts           Fenêtre du hub (peut être fermée puis recréée : toujours passer par getHub())
  background.ts    Option « compter en dehors de l'appli » : icône près de l'horloge + démarrage avec Windows
  playtimeTracker.ts Compteur de temps de jeu (regarde les programmes ouverts toutes les 10 s)
  steamPlaytime.ts Lit le temps de jeu enregistré par Steam (userdata\<compte>\config\localconfig.vdf)
  steamVdf.ts      Lecteur du format VDF binaire de Valve (appinfo.vdf, fichiers de succès)
  steamAppInfo.ts  Lit le cache de Steam (appinfo.vdf binaire + librarycache) : toute la bibliothèque, même non installée
  steamInstalls.ts Bouton « Installer » (Steam, Epic, Battle.net, Riot) + suivi installé / non installé / téléchargement Steam
  steamAchievements.ts Succès Steam lus sur le PC (appcache\stats\UserGameStats*.bin), sans Internet
  gameInfo.ts      Fiche du panneau de détails : page Steam → page Steam trouvée par le nom → Wikipédia
  steamStore.ts    Page Steam d'un jeu (appdetails), rareté des succès, recherche Steam par nom
  wikiInfo.ts      Fiche Wikipédia + Wikidata (jeux absents de Steam)
  httpJson.ts      Téléchargement JSON (User-Agent) + cache des fiches (userData\game-info, 7 jours)
  gameSizes.ts     Taille du dossier des jeux non-Steam (en arrière-plan, une fois par jour)
  knownLaunchers.ts Liste des .exe de launchers connus (jamais « le jeu ») : détection, lancement, temps de jeu
  pcGames/         « + Jeux du PC » : jeux hors Steam
    pcGames.ts       Rassemble les sources, évite les doublons, ajoute les jeux choisis
    epicGames.ts     Jeux Epic installés (.item) et non installés (cache catcache.bin), lien du launcher Epic
    epicInstalls.ts  Suivi installé / non installé des jeux Epic (toutes les 10 s)
    battleNetLaunch.ts Ouvre Battle.net et attend qu'il soit prêt avant de lancer un jeu
    battleNetGames.ts Jeux Battle.net (product.db, protobuf) + gratuits / déjà installés un jour (CATALOG), lancés par Battle.net.exe --exec
    battleNetInstalls.ts Suivi installé / non installé des jeux Battle.net
    riotGames.ts     Jeux Riot (ProgramData\Riot Games\Metadata + registre), installés ou non
    riotLaunch.ts    Lance le jeu via l'interface locale du Riot Client (lockfile), voir « Points fragiles »
    riotInstalls.ts  Suivi installé / non installé des jeux Riot
    gogGames.ts      Jeux GOG (registre), lancés directement
    registry.ts      Lecture du registre Windows (reg query), utilisé par GOG et Riot
    pcGameDetect.ts  Détection générale des .exe : suspects → exclusions → note « est-ce un jeu ? » → nom
    mainExe.ts       Trouve le .exe principal d'un dossier de jeu
  flawless.ts      Flawless Widescreen : trouve FWS, lit ses correctifs, coche « Fix Enabled » avant le jeu
  adminTasks.ts    Tâches planifiées Windows pour lancer un programme en admin (autorisation donnée une fois)
  windowManager.ts TOUT le code Win32 (processus, fenêtres, borderless). N'importe pas Electron.
  gameLauncher.ts  Lancement, recherche de fenêtre (30 s), suivi du processus, kill
  library.ts       CRUD des jeux (library.json), résolution des .lnk
  settings.ts      Paramètres (settings.json) — contient la clé API SteamGridDB
  steamgriddb.ts   API SteamGridDB v2
  covers.ts        Cache des jaquettes (userData/covers) + protocole cover://
  updater.ts       electron-updater
  shortcuts.ts     Raccourci global de fermeture forcée
  guideButton.ts   Bouton Xbox / PS de la manette (appui court / long), lu même hub caché
  gameOverlay.ts   Menu en jeu : fenêtre transparente sur le côté, par-dessus le jeu (#overlay)
  ipc.ts           Tous les ipcMain.handle
src/preload/     contextBridge → window.api (fonctions IPC explicites uniquement)
src/renderer/    Interface React (App.tsx, components/, input/ clavier+manette)
  components/GameDetails.tsx Panneau de détails (clic sur la boîte du centre, touche I, bouton RB) : jeu à gauche, fiche + succès à droite
  components/Shelf.tsx  L'étagère : molette, glisser, clics, et la scène 3D dans un <canvas>
  components/FpsCounter.tsx Compteur d'images par seconde de l'interface (touche F3)
  shelf3d/         Étagère en WebGL (three.js) : ShelfScene.ts (scène, animations, souris), textures.ts
                   (jaquette + badges, tranches, ombres, dessinées dans des <canvas>), tween.ts (courbes façon CSS)
src/shared/      types.ts (types communs) et ipc.ts (noms des canaux IPC)
  launch.ts        Règles de lancement communes (launchedByStore, storeName…)
  duplicates.ts    Doublons (même nom = même jeu : une seule boîte affichée, rien supprimé) + origine du jeu
build/           Icône de l'appli
.github/workflows/release.yml  Construit et publie l'installateur quand on pousse un tag v*
```

Pour ajouter une fonction appelable depuis l'interface : canal dans `shared/ipc.ts` → handler dans
`main/ipc.ts` → exposition dans `preload/index.ts` → utilisation via `window.api.xxx()`.

## Conventions

- **Commentaires et textes de l'interface en français.** Noms de variables/fonctions en anglais.
- **Petits fichiers**, une responsabilité chacun, bien commentés (un débutant doit pouvoir lire le code).
- Sécurité Electron : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Ne jamais exposer
  `ipcRenderer` ou Node directement à l'interface.
- Tout nouveau code Win32 va dans `windowManager.ts`.
- **Toujours une solution générale** : l'appli tourne sur d'autres PC (dossiers différents). Ne jamais coder un chemin
  en dur : lire où sont les choses dans les fichiers / le registre du launcher, comme les modules de `pcGames/`.

### Ajouter un launcher (modèle : Riot, Battle.net)
- `pcGames/<launcher>Games.ts` renvoie des `DetectedGame` (installés, et `installed: false` pour les non installés) ;
  `<launcher>Installs.ts` suit installé / non installé toutes les 10 s (démarré dans `index.ts`).
- Branchement : `GameSource` (`shared/types.ts`), `findAll()` / `isAlreadyAdded()` / `addPcGames()` dans `pcGames.ts`,
  section `SECTIONS` de `PcImport.tsx`, `storeName()` (`shared/launch.ts`), `originLabel()` (`shared/duplicates.ts`),
  `installGame()` (`steamInstalls.ts`).
- Jeu lancé par son launcher : `launchKind: 'store'`, `exePath`/`args` = commande du launcher, `gameFolder` = dossier
  du jeu (le jeu est reconnu à son dossier). Ajouter le .exe du launcher dans `knownLaunchers.ts`.
- Ouvrir un lien de programme (`xxx://`) avec `rundll32.exe url.dll,FileProtocolHandler` ou `shell.openExternal`,
  jamais avec explorer.exe (il ouvre Documents).

## Commandes

| Commande | Usage |
| --- | --- |
| `npm install` | Installe les dépendances (le `postinstall` télécharge Electron) |
| `npm run dev` | Lance l'appli en développement |
| `npm run typecheck` | Vérification TypeScript — à lancer avant chaque commit |
| `npm run build` | Compile dans `out/` |
| `npm run dist` | Crée l'installateur local dans `release/` (sans publier) |

La publication est faite par `.github/workflows/release.yml` : `npm run dist`, puis `gh release create`
avec l'installateur, le `.blockmap` et `latest.yml`. Ne pas utiliser `electron-builder --publish always`
(course entre les envois qui perd l'installateur quand la Release n'existe pas encore).

Publier une version (`main` est protégée, PR obligatoire, voir README) : sur une branche,
`npm version X.Y.Z --no-git-tag-version` → commit → PR → merge ; puis sur `main` à jour,
`git tag vX.Y.Z` et `git push origin vX.Y.Z`. La GitHub Action
vérifie que le tag = la version de package.json, construit l'installateur et publie la Release ;
les applis installées proposent la mise à jour.

## Règles (IMPORTANT)

1. **Ne JAMAIS commiter de clé API, mot de passe, token ou fichier `settings.json`.** La clé SteamGridDB vit
   uniquement dans `userData` sur le PC de chacun. Vérifier `git status` / `git diff --staged` avant chaque commit.
2. **Ne jamais travailler directement sur `main`** (elle est protégée : un push direct est refusé). Créer une branche (`git checkout -b nom-de-la-tache`),
   commiter dessus, pousser, puis ouvrir une Pull Request (`gh pr create`).
3. **Tester avant de commiter** : `npm run typecheck` + vérifier dans `npm run dev` que la fonctionnalité marche.
4. Demander confirmation avant toute action irréversible ou visible par l'autre (push, merge, tag, release, suppression).
5. Messages de commit en français, courts et clairs (« Ajoute… », « Corrige… »).

## Points fragiles à connaître

- Le plein écran forcé dépend des jeux : jeux en plein écran exclusif, anti-cheat, launchers (Steam/Epic/Ubisoft)
  qui lancent le jeu via un autre processus, jeux qui se redimensionnent eux-mêmes. Une option par jeu permet
  de désactiver le plein écran forcé.
- Pendant un lancement, un launcher qui passe devant est remis derrière Gamer Room, une fois par fenêtre
  (`keepHubInFront` dans `gameLauncher.ts`). Le salon de League of Legends est un launcher (pas de plein écran forcé).
- **Riot** a désactivé le lancement automatique (`--launch-product` ouvre seulement la page du jeu). `riotLaunch.ts`
  envoie `POST /product-launcher/v1/products/<produit>/patchlines/<version>` à l'interface locale du Riot Client
  (port + mot de passe temporaire dans `%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile`). Ne jamais utiliser
  autre chose de cette interface (rien qui touche au compte).
- **Epic** ne garde pas le temps de jeu sur le PC (seulement sur ses serveurs, avec le compte connecté) : mis de côté.
  Battle.net ne garde pas non plus la liste des jeux achetés (d'où la liste `CATALOG`).
- **Fiches de jeux** : la recherche Steam (`storesearch`) ne répond qu'avec un pays (`cc`) ; on n'accepte qu'un nom
  identique (`gameKey`). Wikidata range beaucoup de noms en langue `mul` ; son numéro Steam (P1733) est parfois faux,
  ne pas s'y fier. Wikipédia limite à 10 demandes/min sans contact dans le User-Agent (200 avec) : garder l'adresse
  du projet dans `httpJson.ts`.
- Les raccourcis `.lnk` vers des URL (`steam://…`) ne sont pas supportés pour l'instant.
- L'appli n'est pas signée → avertissement SmartScreen à l'installation.
- **Performances de l'étagère** : ne JAMAIS refaire les boîtes en 3D CSS (`preserve-3d`, `box-reflect`…). Chromium
  recalcule tout avec le processeur à chaque image (1,75 cœur sur un écran 174 Hz, l'appli ramait). L'étagère est
  en WebGL (`shelf3d/`), comme BoxShelf. Les jaquettes y sont des textures : le protocole `cover://` envoie
  `Access-Control-Allow-Origin` pour ça (`covers.ts`). `force_high_performance_gpu` (`index.ts`) choisit la carte
  graphique la plus puissante sur les PC qui en ont deux.
- **Processus principal = souris et clavier** : tant qu'il est occupé, l'interface ne reçoit plus rien (« ça coupe
  puis ça reprend »). Dans tout ce qui tourne en boucle (suivis toutes les 5-10 s), jamais de commande bloquante
  (`execFileSync`, `reg query … /s` sur un gros arbre) : utiliser les versions `…Async` de `pcGames/registry.ts`.
  Exemple corrigé : le suivi Riot figeait l'appli 2 s toutes les 10 s en relisant toute la liste des programmes.
