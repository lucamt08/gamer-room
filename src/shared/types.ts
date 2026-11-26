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
}

/** Les champs qu'on peut modifier depuis l'écran "Modifier". */
export type GamePatch = Partial<Pick<Game, 'name' | 'args' | 'forceFullscreen'>>

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
  /** Message court pour l'utilisateur (ex. "Plein écran appliqué"). */
  message?: string
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
