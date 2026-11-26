// Types partagés entre le processus principal (main) et l'interface (renderer).
// Si tu ajoutes un champ à un jeu ou aux paramètres, c'est ici qu'il faut le déclarer.

/** Un jeu (ou programme) de la bibliothèque. */
export interface Game {
  /** Identifiant unique, généré à l'ajout. */
  id: string
  /** Nom affiché sous la boîte (modifiable). */
  name: string
  /** Chemin complet vers le .exe à lancer. */
  exePath: string
  /** Arguments de lancement, ex. "-windowed -novid". */
  args: string
  /** Dossier dans lequel lancer le jeu (par défaut : le dossier du .exe). */
  workingDir: string
  /** Nom du fichier de jaquette dans le cache (dossier userData/covers), ou null. */
  coverFile: string | null
  /** Identifiant du jeu chez SteamGridDB, si on l'a trouvé. */
  steamGridDbId: number | null
  /** Forcer le plein écran fenêtré sans bordure au lancement ? */
  forceFullscreen: boolean
  /** Date d'ajout (format ISO). */
  addedAt: string
  /** Dernière fois que le jeu a été lancé (format ISO), ou null. */
  lastPlayedAt: string | null
  /**
   * Éditeur lu dans le .exe (ex. "Sony Interactive Entertainment"), ou null si inconnu.
   * Absent pour les jeux ajoutés avant cette version (rempli à la prochaine recherche de jaquette).
   */
  publisher?: string | null
  /**
   * Ce que lance vraiment `exePath` (détecté à l'ajout, voir launcherDetect.ts) :
   *  - 'game'     : le jeu lui-même ;
   *  - 'launcher' : un launcher avec une fenêtre (REDlauncher de Cyberpunk, Longshot…) ;
   *  - 'relay'    : un petit .exe sans fenêtre qui démarre aussitôt le vrai jeu (b1.exe de Wukong) ;
   *  - 'steam'    : un jeu Steam, lancé par Steam.
   * Absent pour les jeux ajoutés avant cette version (détecté au prochain lancement).
   */
  launchKind?: LaunchKind
  /** Chemin du vrai .exe du jeu quand on passe par un launcher (connu à l'ajout ou appris au premier lancement). */
  realExePath?: string | null
  /** Dossier d'installation du jeu : toute fenêtre d'un programme de ce dossier est "la fenêtre du jeu". */
  gameFolder?: string | null
  /** Numéro du jeu chez Steam (jeux Steam uniquement). */
  steamAppId?: number | null
  /**
   * Launcher : lancer directement le vrai .exe du jeu, sans ouvrir le launcher ?
   * Absent = choix automatique (voir shouldSkipLauncher dans shared/launch.ts).
   */
  skipLauncher?: boolean
}

export type LaunchKind = 'game' | 'launcher' | 'relay' | 'steam'

/** Un jeu Steam installé sur le PC (pour l'import). */
export interface SteamGameEntry {
  appId: number
  name: string
  /** Dossier d'installation, ex. D:\SteamLibrary\steamapps\common\Cyberpunk 2077 */
  installDir: string
  /** Déjà présent dans la bibliothèque ? */
  alreadyAdded: boolean
}

/** Les champs qu'on peut modifier depuis l'écran "Modifier". */
export type GamePatch = Partial<Pick<Game, 'name' | 'args' | 'forceFullscreen' | 'skipLauncher'>>

/** Paramètres de l'application (stockés localement, jamais dans le dépôt Git). */
export interface Settings {
  /** Clé API SteamGridDB personnelle (vide = pas de jaquettes automatiques). */
  steamGridDbApiKey: string
  /** Raccourci global pour forcer la fermeture du jeu en cours (format Electron). */
  killShortcut: string
  /** Démarrer le hub en plein écran (façon Big Picture) ? */
  startFullscreen: boolean
}

/** Un résultat de recherche SteamGridDB (un jeu). */
export interface SgdbGame {
  id: number
  name: string
  /** Année de sortie si connue. */
  year: number | null
}

/** Résultat d'une recherche SteamGridDB, avec correction automatique du nom si besoin. */
export interface SgdbSearchResult {
  /** Jeux trouvés (du plus ressemblant au moins ressemblant quand le nom a été corrigé). */
  results: SgdbGame[]
  /**
   * Orthographe qui a permis de trouver des résultats quand le nom tapé ne donnait rien
   * (ex. "Horizon Forbidden West" pour "HorizonForbiddenWest_x64"), sinon null.
   */
  correctedTerm: string | null
}

/** Une jaquette (grid) SteamGridDB. */
export interface SgdbGrid {
  id: number
  url: string
  thumb: string
  width: number
  height: number
}

/** Résultat de la recherche automatique de jaquette après l'ajout d'un jeu. */
export type AutoCoverResult =
  | { status: 'applied'; game: Game }
  | { status: 'multiple'; results: SgdbGame[] }
  | { status: 'none' }
  | { status: 'no-key' }
  | { status: 'error'; message: string }

/** État du jeu en cours, envoyé à l'interface. */
export interface RunningState {
  running: boolean
  gameId: string | null
  /**
   * Étape du lancement (pour l'écran de chargement) :
   *  - 'starting' : le jeu (ou son launcher) démarre, on attend sa fenêtre ;
   *  - 'launcher' : la fenêtre d'un launcher est ouverte, il faut y cliquer sur "Jouer" ;
   *  - 'playing'  : la fenêtre du jeu est là, le hub est caché.
   */
  phase?: 'starting' | 'launcher' | 'playing'
  /** Message court pour l'utilisateur (ex. "Plein écran appliqué"). */
  message?: string
  /** Le jeu à jour, quand le lancement a appris quelque chose (vrai .exe, nouveau nom, jaquette…). */
  game?: Game
}

/** État de la mise à jour automatique, envoyé à l'interface. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
