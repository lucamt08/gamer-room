// Le "preload" est le pont entre l'interface et le main.
// On expose à l'interface UNIQUEMENT les fonctions listées ici, sous `window.api`.
// L'interface n'a pas accès à Node.js ni au disque directement : c'est voulu (sécurité).

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AutoCoverResult,
  Game,
  GamePatch,
  RunningState,
  SgdbGrid,
  SgdbSearchResult,
  Settings,
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
  /** Chemin complet d'un fichier glissé-déposé dans la fenêtre. */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // --- Lancement ---
  launchGame: (id: string): Promise<void> => ipcRenderer.invoke(IPC.launchGame, id),
  killGame: (): Promise<void> => ipcRenderer.invoke(IPC.killGame),
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

  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getVersion)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
