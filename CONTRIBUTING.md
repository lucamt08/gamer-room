# Contribuer à Gamer Room — guide Git pour grand débutant

Ce guide t'explique **pas à pas** comment travailler à deux sur le projet avec Git et GitHub,
sans rien casser. Pas besoin de connaître Git : suis les étapes dans l'ordre.

> 💡 Si tu codes avec Claude, il lit le fichier `CLAUDE.md` et connaît ces règles. Tu peux
> lui demander « crée une branche pour ma fonctionnalité », « fais un commit », « ouvre une PR »…

---

## 📖 Petit glossaire (à lire en premier)

| Mot | Ce que ça veut dire |
| --- | --- |
| **Repo** (dépôt) | Le projet complet avec tout son historique. Il existe sur GitHub (en ligne) et sur ton PC (une copie). |
| **Commit** | Une « sauvegarde » de tes modifications, avec un petit message qui explique ce que tu as fait. |
| **Branche** | Une version parallèle du projet où tu peux travailler sans toucher à celle des autres. La branche principale s'appelle `main`. |
| **Push** | Envoyer tes commits de ton PC vers GitHub. |
| **Pull** | Récupérer sur ton PC les nouveautés qui sont sur GitHub. |
| **PR** (Pull Request) | Une demande pour intégrer ta branche dans `main`. L'autre peut relire, commenter, puis valider. |
| **Merge** (fusion) | L'action d'intégrer une branche dans une autre (souvent : ta branche dans `main`). |
| **Conflit** | Quand vous avez modifié tous les deux **les mêmes lignes** du même fichier : Git ne sait pas laquelle garder et te demande de choisir. |
| **Clone** | Télécharger le repo sur ton PC pour la première fois. |

**La règle d'or : on ne travaille jamais directement sur `main`.** On crée une branche, on fait ses
commits dessus, puis on ouvre une Pull Request.

---

## 1. Installer les outils (une seule fois)

1. **Git** : <https://git-scm.com/download/win> → installe avec les options par défaut.
2. **GitHub Desktop** (interface graphique, plus simple que le terminal) : <https://desktop.github.com>
   → lance-le et connecte-toi avec ton compte GitHub.
3. **Node.js LTS** : <https://nodejs.org> → bouton « LTS ».
4. **Un éditeur de code** : [Visual Studio Code](https://code.visualstudio.com) (recommandé).

Vérifie dans un terminal (PowerShell) :

```bash
node --version
git --version
```

Configure ton nom pour les commits (une seule fois) :

```bash
git config --global user.name "TonPseudoGitHub"
git config --global user.email "TON_ID+TonPseudo@users.noreply.github.com"
```

> L'adresse « noreply » se trouve sur GitHub → photo de profil → **Settings → Emails**.
> Elle évite d'afficher ton vrai e-mail publiquement.

## 2. Accepter l'invitation

Le propriétaire du dépôt t'invite comme **collaborateur**. Tu reçois un e-mail (ou une notification sur
github.com) : clique sur **Accept invitation**. Sans ça, tu ne pourras pas pousser.

## 3. Cloner le dépôt (une seule fois)

**Avec GitHub Desktop :** *File → Clone repository…* → onglet **GitHub.com** → choisis `lucamt08/gamer-room`
→ choisis un dossier (évite les dossiers synchronisés OneDrive) → **Clone**.

**Avec le terminal :**

```bash
git clone https://github.com/lucamt08/gamer-room.git
cd gamer-room
```

Puis installe les dépendances et lance l'appli :

```bash
npm install
npm run dev
```

## 4. Le cycle de travail (à chaque nouvelle tâche)

### a) Mettre ta copie à jour

Avant de commencer quoi que ce soit, récupère les dernières modifications de `main`.

- **GitHub Desktop :** *Current branch* → `main`, puis **Fetch origin** → **Pull origin**.
- **Terminal :**
  ```bash
  git checkout main
  git pull
  ```

Si quelqu'un a ajouté des dépendances, relance `npm install`.

### b) Créer une branche

Donne-lui un nom court qui décrit la tâche, par exemple `ajout-temps-de-jeu` ou `fix-manette-ps5`.

- **GitHub Desktop :** *Current branch* → **New branch** → tape le nom → **Create branch**.
- **Terminal :**
  ```bash
  git checkout -b ajout-temps-de-jeu
  ```

### c) Coder et tester

Modifie le code (toi ou Claude), puis **teste** avec `npm run dev`. Vérifie aussi :

```bash
npm run typecheck
```

### d) Faire un commit

Un commit = un petit paquet de modifications cohérent, avec un message clair en français
(ex. « Ajoute le temps de jeu sous chaque boîte »).

- **GitHub Desktop :** à gauche, coche les fichiers modifiés, écris le résumé en bas à gauche → **Commit to ma-branche**.
- **Terminal :**
  ```bash
  git add .
  git commit -m "Ajoute le temps de jeu sous chaque boîte"
  ```

> ⚠️ Vérifie toujours la liste des fichiers avant de commiter : **jamais de clé API, de mot de passe
> ou de fichier `settings.json`** dans un commit.

Tu peux faire plusieurs commits sur la même branche.

### e) Pousser ta branche sur GitHub

- **GitHub Desktop :** bouton **Publish branch** (la première fois), puis **Push origin**.
- **Terminal :**
  ```bash
  git push -u origin ajout-temps-de-jeu
  ```

### f) Ouvrir une Pull Request

1. Va sur <https://github.com/lucamt08/gamer-room>. Un bandeau jaune propose **Compare & pull request** : clique dessus.
   (Ou dans GitHub Desktop : **Create Pull Request**.)
2. Écris un titre et une description : *ce que ça fait*, *comment tester*.
3. Clique **Create pull request**.
4. L'autre personne relit, commente si besoin, puis clique **Merge pull request** → **Confirm merge**.
5. Après le merge, clique **Delete branch** (la branche ne sert plus).

Puis, sur ton PC, retourne sur `main` et fais un **pull** (étape a).

## 5. Résoudre un conflit

Un conflit arrive quand vous avez modifié **les mêmes lignes**. Git marque le fichier ainsi :

```
<<<<<<< HEAD
ta version
=======
la version de l'autre
>>>>>>> main
```

1. Ouvre le fichier (VS Code affiche des boutons *Accept Current / Accept Incoming / Accept Both*).
2. Garde le bon code et **supprime les lignes `<<<<<<<`, `=======`, `>>>>>>>`**.
3. Teste (`npm run dev`), puis fais un commit et un push.

Pas de panique : tant que tu n'as pas poussé, rien n'est cassé pour l'autre. Et Claude sait très bien
résoudre les conflits : demande-lui « aide-moi à résoudre ce conflit ».

## 6. Conseils

- **Pull souvent**, surtout avant de commencer.
- **Petites branches, petites PR** : plus facile à relire, moins de conflits.
- **Prévenez-vous** quand vous travaillez sur le même fichier (surtout `windowManager.ts`).
- Si tu es perdu : `git status` (terminal) ou regarde GitHub Desktop, ça dit où tu en es.
- Rien n'est jamais vraiment perdu avec Git : demande de l'aide avant de supprimer quoi que ce soit.

## 7. Publier une version

Voir la section « Comment publier une nouvelle version » du [README](README.md#-comment-publier-une-nouvelle-version).
