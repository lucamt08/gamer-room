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
  /**
   * Temps de jeu compté par Gamer Room, en secondes (voir playtimeTracker.ts).
   * Comprend la valeur de départ choisie dans l'écran "Modifier". Absent = 0.
   */
  playtimeSeconds?: number
  /**
   * Jeux Steam : temps de jeu lu dans les fichiers de Steam, en minutes (voir steamPlaytime.ts).
   * Absent ou null = pas encore lu (on affiche alors le temps compté par Gamer Room).
   */
  steamPlaytimeMinutes?: number | null
  /**
   * Correctif Flawless Widescreen à activer au lancement (voir flawless.ts) :
   *  - absent ou 'auto' : celui reconnu automatiquement (sauf jeux avec anti-cheat) ;
   *  - 'off'            : jamais de correctif pour ce jeu ;
   *  - sinon            : la clé d'un correctif choisi à la main, ex. "FWS_Plugins/Persona5Royal".
   */
  fwsModule?: string
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
export type GamePatch = Partial<Pick<Game, 'name' | 'args' | 'forceFullscreen' | 'skipLauncher' | 'playtimeSeconds' | 'fwsModule'>>

/** Paramètres de l'application (stockés localement, jamais dans le dépôt Git). */
export interface Settings {
  /** Clé API SteamGridDB personnelle (vide = pas de jaquettes automatiques). */
  steamGridDbApiKey: string
  /** Raccourci global pour forcer la fermeture du jeu en cours (format Electron). */
  killShortcut: string
  /** Démarrer le hub en plein écran (façon Big Picture) ? */
  startFullscreen: boolean
  /**
   * Compter le temps de jeu même quand le jeu n'est pas lancé depuis Gamer Room ?
   * Si oui : Gamer Room démarre avec Windows, et la croix du hub la cache près de l'horloge
   * au lieu de la quitter (voir background.ts).
   */
  trackOutsideApp: boolean
  /** Dossier de Flawless Widescreen choisi à la main ('' = recherche automatique). */
  fwsPath: string

  // --- Clavier / souris ---
  /** Molette : niveau de vitesse, de 1 (très lent) à 5 (très rapide) ; 3 = moyen (vitesse d'origine). */
  wheelLevel: number
  /** Molette : accélérer quand on tourne vite ? */
  wheelAcceleration: boolean
  /** Souris : glisser horizontalement (clic maintenu) fait défiler les jaquettes ? */
  dragScroll: boolean
  /** Souris : sensibilité du glisser (1 = lent, 5 = rapide). */
  dragSensitivity: number

  // --- Son ---
  /** Jouer un petit "clic" à chaque jaquette quand on fait défiler ? */
  scrollSound: boolean
  /** Volume de ce clic, de 1 (très doux) à 10 (fort). */
  scrollSoundVolume: number

  // --- Manette ---
  /** Manette : vitesse quand on maintient une direction, de 1 (lent) à 9 (rapide) ; 5 = moyen (vitesse d'origine). */
  gamepadSpeed: number
  /** Manette : accélérer quand on maintient la direction longtemps ? */
  gamepadAcceleration: boolean
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
   *  - 'playing'  : la fenêtre du jeu est là, le hub est caché ;
   *  - 'flawless' : avant le jeu, Gamer Room démarre Flawless Widescreen avec le correctif activé.
   */
  phase?: 'flawless' | 'starting' | 'launcher' | 'playing'
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

/** Un correctif installé dans Flawless Widescreen (un "module", ex. Persona 5 Royal). */
export interface FwsModule {
  /** Identifiant unique : "<plugin>/<module>", ex. "FWS_Plugins/Persona5Royal". */
  key: string
  /** Nom du plugin, ex. "FWS_Plugins". */
  plugin: string
  /** Nom du module, ex. "Persona5Royal". */
  module: string
  /** Nom lisible, ex. "Persona 5 Royal". */
  name: string
  /** Noms des .exe du jeu (en minuscules), lus dans le script du correctif. Vide = n'importe quel .exe. */
  exeNames: string[]
  /** Le correctif prévient d'un anti-cheat (risque de bannissement) : jamais activé automatiquement. */
  anticheat: boolean
}

/** État de Flawless Widescreen sur ce PC (pour les paramètres). */
export interface FwsStatus {
  /** Dossier d'installation trouvé, ou null. */
  folder: string | null
  /** L'autorisation administrateur "une seule fois" a-t-elle été donnée ? */
  authorized: boolean
  /** Nombre de correctifs installés. */
  moduleCount: number
}

/** Ce que l'écran "Modifier" doit savoir sur Flawless Widescreen pour un jeu. */
export interface FwsGameInfo {
  /** Flawless Widescreen est-il installé ? (sinon on n'affiche rien) */
  installed: boolean
  /** Tous les correctifs installés, triés par nom. */
  modules: FwsModule[]
  /** Clé du correctif reconnu automatiquement pour ce jeu, ou null. */
  detectedKey: string | null
}
