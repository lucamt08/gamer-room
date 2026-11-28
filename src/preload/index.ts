// Le "preload" est le pont entre l'interface et le main.
// On expose à l'interface UNIQUEMENT les fonctions listées ici, sous `window.api`.
// L'interface n'a pas accès à Node.js ni au disque directement : c'est voulu (sécurité).

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AutoCoverResult,
  FwsGameInfo,
  FwsStatus,
  Game,
  GamePatch,
  OverlayAction,
  OverlayInfo,
  RunningState,
  SgdbGrid,
  SgdbSearchResult,
  Settings,
  SteamGameEntry,
  GameInfo,
  InstallProgress,
  DetectedGame,
  UpdateStatus
} from '@shared/types'

/** S'abonne à un message envoyé par le main. Renvoie une fonction pour se désabonner. */
function listen<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  // --- Bibliothèque ---
  getGames: (): Promise<Game[]> => ipcRenderer.invoke(IPC.getGames),
  pickExecutable: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickExecutable),
  addGame: (path: string): Promise<Game> => ipcRenderer.invoke(IPC.addGame, path),
  updateGame: (id: string, patch: GamePatch): Promise<Game> => ipcRenderer.invoke(IPC.updateGame, id, patch),
  removeGame: (id: string): Promise<void> => ipcRenderer.invoke(IPC.removeGame, id),
  /** Un jeu a été corrigé en arrière-plan (vrai nom, jaquette…). */
  onGameUpdated: (cb: (game: Game) => void) => listen(IPC.gameUpdated, cb),
  /** Jeux de la bibliothèque Steam (installés ou non). */
  steamListGames: (): Promise<SteamGameEntry[]> => ipcRenderer.invoke(IPC.steamListGames),
  /** Ajoute les jeux Steam choisis (par leur numéro Steam). */
  steamAddGames: (appIds: number[]): Promise<Game[]> => ipcRenderer.invoke(IPC.steamAddGames, appIds),
  /** Jeux du PC hors Steam (Epic, Battle.net, GOG, jeux sans launcher) pas encore dans Gamer Room. */
  pcListGames: (): Promise<{ games: DetectedGame[]; alreadyAdded: number }> => ipcRenderer.invoke(IPC.pcListGames),
  /** Ajoute les jeux du PC choisis (par leur clé). */
  pcAddGames: (keys: string[]): Promise<Game[]> => ipcRenderer.invoke(IPC.pcAddGames, keys),
  /** Choisir un dossier de jeux en plus, puis relancer la recherche. */
  pcAddFolder: (): Promise<{ games: DetectedGame[]; alreadyAdded: number }> => ipcRenderer.invoke(IPC.pcAddFolder),
  /** Ouvre la fenêtre d'installation du magasin (Steam ou Epic) pour un jeu pas installé. */
  installGame: (id: string): Promise<void> => ipcRenderer.invoke(IPC.installGame, id),
  /** Panneau de détails : fiche du jeu (page Steam ou Wikipédia) et succès Steam. */
  gameInfo: (id: string): Promise<GameInfo> => ipcRenderer.invoke(IPC.gameInfo, id),
  /** Avancement des téléchargements Steam en cours (id du jeu → pourcentage). */
  onInstallProgress: (cb: (progress: InstallProgress) => void) => listen(IPC.steamInstallProgress, cb),
  /** Chemin complet d'un fichier glissé-déposé dans la fenêtre. */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // --- Lancement ---
  launchGame: (id: string): Promise<void> => ipcRenderer.invoke(IPC.launchGame, id),
  killGame: (): Promise<void> => ipcRenderer.invoke(IPC.killGame),
  /** Jeu en cours : cache Gamer Room et remet le jeu au premier plan. */
  resumeGame: (): Promise<void> => ipcRenderer.invoke(IPC.resumeGame),
  onRunningState: (cb: (state: RunningState) => void) => listen(IPC.runningState, cb),

  // --- SteamGridDB ---
  /** Recherche un jeu ; si le nom ne donne rien, essaie des orthographes corrigées. */
  sgdbSearch: (term: string): Promise<SgdbSearchResult> => ipcRenderer.invoke(IPC.sgdbSearch, term),
  sgdbGrids: (sgdbId: number): Promise<SgdbGrid[]> => ipcRenderer.invoke(IPC.sgdbGrids, sgdbId),
  sgdbSetCover: (gameId: string, url: string, sgdbId: number): Promise<Game> =>
    ipcRenderer.invoke(IPC.sgdbSetCover, gameId, url, sgdbId),
  sgdbAutoCover: (gameId: string): Promise<AutoCoverResult> => ipcRenderer.invoke(IPC.sgdbAutoCover, gameId),

  // --- Paramètres ---
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.saveSettings, patch),

  // --- Fenêtre ---
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke(IPC.toggleFullscreen),
  setFullscreen: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC.setFullscreen, value),

  // --- Mise à jour ---
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => listen(IPC.updateStatus, cb),
  checkUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.checkUpdate),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.downloadUpdate),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.installUpdate),

  // --- Flawless Widescreen ---
  /** Correctifs installés + celui reconnu pour ce jeu (écran "Modifier"). */
  fwsGameInfo: (gameId: string): Promise<FwsGameInfo> => ipcRenderer.invoke(IPC.fwsGameInfo, gameId),
  fwsStatus: (): Promise<FwsStatus> => ipcRenderer.invoke(IPC.fwsStatus),
  /** Demande l'autorisation administrateur (une seule fois) pour lancer Flawless Widescreen. */
  fwsAuthorize: (): Promise<FwsStatus> => ipcRenderer.invoke(IPC.fwsAuthorize),
  fwsPickFolder: (): Promise<FwsStatus> => ipcRenderer.invoke(IPC.fwsPickFolder),

  // --- Menu en jeu (bouton Guide / PS maintenu) ---
  /** Le menu vient de s'ouvrir par-dessus le jeu. */
  onOverlayOpened: (cb: (info: OverlayInfo) => void) => listen(IPC.overlayOpened, cb),
  overlayAction: (action: OverlayAction): Promise<void> => ipcRenderer.invoke(IPC.overlayAction, action),

  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getVersion)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
