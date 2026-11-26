# 🎮 Gamer Room

**Gamer Room** est un hub de bibliothèque de jeux façon console, pour **Windows 10 / 11**.
Tes jeux sont rangés comme des **boîtes sur une étagère** (inspiré du frontend open source BoxShelf),
avec leurs jaquettes, et se lancent **automatiquement en plein écran sans bordure**.

> Projet en phase de **prototype** (version 0.x) : ça marche, mais attends-toi à des bugs.

## ✨ Fonctionnalités

- **Ajouter un jeu / programme** : bouton « + Ajouter » ou **glisser-déposer** un `.exe` ou un raccourci `.lnk` dans la fenêtre.
- **Boîtes de jeu en 3D légère** avec jaquette et tranche visible.
- **Jaquettes automatiques** via [SteamGridDB](https://www.steamgriddb.com) (clé API gratuite requise, voir plus bas).
- **Plein écran forcé** : au lancement, la fenêtre du jeu est passée en plein écran fenêtré sans bordure sur son écran
  (désactivable par jeu dans « Modifier »).
- Le hub **se cache pendant que tu joues** et **réapparaît** quand le jeu se ferme.
- **Fermeture forcée** du jeu en cours avec `Ctrl+Alt+F4` (modifiable dans les Paramètres).
- **Navigation** à la souris, au clavier ou à la **manette** (Xbox / PlayStation).
- **Mode plein écran** façon Big Picture : touche `F11` ou option dans les Paramètres.
- **Mise à jour automatique** : l'appli te prévient quand une nouvelle version est publiée.

## 📥 Installer l'appli (pour jouer / tester)

1. Va sur la page **[Releases](https://github.com/lucamt08/gamer-room/releases/latest)** du dépôt.
2. Télécharge `gamer-room-setup-X.Y.Z.exe` (dans « Assets »).
3. Lance-le.

### ⚠️ Avertissement Windows SmartScreen

L'appli n'est **pas signée** (un certificat de signature coûte cher). Au premier lancement, Windows affiche
**« Windows a protégé votre ordinateur »**. C'est normal :

1. clique sur **« Informations complémentaires »** ;
2. puis sur **« Exécuter quand même »**.

Ton navigateur peut aussi dire que le fichier « n'est pas couramment téléchargé » : choisis **Conserver**.
Ensuite, les mises à jour s'installent toutes seules depuis l'appli.

## 🔑 Obtenir une clé API SteamGridDB (gratuit)

1. Crée un compte sur [steamgriddb.com](https://www.steamgriddb.com) (connexion avec Steam).
2. Va dans **Préférences → API** : <https://www.steamgriddb.com/profile/preferences/api>.
3. Clique sur **Generate API Key** et copie la clé.
4. Dans Gamer Room : **Paramètres → Clé API SteamGridDB**, colle la clé et clique **Enregistrer**.

La clé est enregistrée **uniquement sur ton PC** (dans `%APPDATA%\Gamer Room\settings.json`).
Elle n'est **jamais** envoyée sur GitHub. Chacun utilise sa propre clé.

## 🎮 Commandes

| Action                  | Clavier        | Manette Xbox | Manette PlayStation |
| ----------------------- | -------------- | ------------ | ------------------- |
| Se déplacer             | Flèches        | Stick / croix | Stick / croix      |
| Jouer                   | Entrée         | A            | Croix               |
| Retour / fermer         | Échap          | B            | Rond                |
| Modifier le jeu         | E              | Y            | Triangle            |
| Changer la jaquette     | C              | X            | Carré               |
| Paramètres              | P              | Start        | Options             |
| Ajouter un jeu          | A              | Select       | Share               |
| Plein écran du hub      | F11            | —            | —                   |
| Forcer la fermeture du jeu | Ctrl+Alt+F4 | —           | —                   |

## 🛠️ Développer (pour contribuer)

Prérequis : [Node.js LTS](https://nodejs.org) et [Git](https://git-scm.com). Le guide complet pour débuter
avec Git est dans **[CONTRIBUTING.md](CONTRIBUTING.md)**.

```bash
git clone https://github.com/lucamt08/gamer-room.git
cd gamer-room
npm install       # installe les dépendances (et télécharge Electron)
npm run dev       # lance l'appli en mode développement (rechargement automatique)
```

Autres commandes :

| Commande            | Ce qu'elle fait                                                        |
| ------------------- | ---------------------------------------------------------------------- |
| `npm run dev`       | Lance l'appli en développement                                         |
| `npm run typecheck` | Vérifie les erreurs TypeScript                                         |
| `npm run build`     | Compile l'appli dans `out/`                                            |
| `npm run dist`      | Crée l'installateur Windows dans `release/` (sans le publier)          |

Les données de l'appli (bibliothèque, paramètres, jaquettes) sont dans `%APPDATA%\Gamer Room\`.

## 🚀 Comment publier une nouvelle version

C'est **GitHub** qui construit et publie l'installateur, pas ton PC. Il suffit de créer un **tag**.

1. Assure-toi que `main` est à jour et que tout marche (`npm run dev`).
2. Choisis le nouveau numéro de version ([semver](https://semver.org/lang/fr/)) :
   - `0.1.0` → `0.1.1` pour une correction de bug,
   - `0.1.0` → `0.2.0` pour une nouvelle fonctionnalité.
3. Dans un terminal, sur la branche `main` :

   ```bash
   git checkout main
   git pull
   npm version 0.2.0       # met à jour package.json, crée un commit ET le tag v0.2.0
   git push --follow-tags  # envoie le commit et le tag sur GitHub
   ```

4. Va dans l'onglet **Actions** du dépôt : l'action « Release » tourne (~5 min).
5. Quand elle est verte ✅, la nouvelle version apparaît dans **Releases**. Les applis déjà installées
   proposeront la mise à jour à leur prochain démarrage.

> Si `main` est protégée (Pull Requests obligatoires), `git push` de ce commit peut être refusé :
> fais alors le changement de version dans une PR, puis crée seulement le tag :
> `git tag v0.2.0` puis `git push origin v0.2.0`.

## 📁 Organisation du code

```
src/
  main/            Processus principal (Node.js) : fenêtres, fichiers, lancement des jeux
    index.ts         Point d'entrée : crée la fenêtre du hub
    windowManager.ts ⚙️ Tout le code Win32 (trouver la fenêtre du jeu, plein écran sans bordure)
    gameLauncher.ts  Lance un jeu, cache/réaffiche le hub, détecte la fin du jeu
    library.ts       Liste des jeux (library.json)
    settings.ts      Paramètres (settings.json, contient la clé API)
    steamgriddb.ts   Appels à l'API SteamGridDB
    covers.ts        Cache des jaquettes + adresse cover://
    updater.ts       Mise à jour automatique
    shortcuts.ts     Raccourci global de fermeture forcée
    ipc.ts           Fonctions appelables depuis l'interface
  preload/         Le "pont" sécurisé entre l'interface et le main (window.api)
  renderer/        L'interface React
    src/App.tsx      Écran principal
    src/components/  Boîtes, étagère, fenêtres (Modifier, Jaquette, Paramètres)
    src/input/       Clavier + manette
  shared/          Types communs au main et à l'interface
```
