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
  windowManager.ts TOUT le code Win32 (processus, fenêtres, borderless). N'importe pas Electron.
  gameLauncher.ts  Lancement, recherche de fenêtre (30 s), suivi du processus, kill
  library.ts       CRUD des jeux (library.json), résolution des .lnk
  settings.ts      Paramètres (settings.json) — contient la clé API SteamGridDB
  steamgriddb.ts   API SteamGridDB v2
  covers.ts        Cache des jaquettes (userData/covers) + protocole cover://
  updater.ts       electron-updater
  shortcuts.ts     Raccourci global de fermeture forcée
  ipc.ts           Tous les ipcMain.handle
src/preload/     contextBridge → window.api (fonctions IPC explicites uniquement)
src/renderer/    Interface React (App.tsx, components/, input/ clavier+manette)
src/shared/      types.ts (types communs) et ipc.ts (noms des canaux IPC)
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
- Les raccourcis `.lnk` vers des URL (`steam://…`) ne sont pas supportés pour l'instant.
- L'appli n'est pas signée → avertissement SmartScreen à l'installation.
