// Branche chaque fonction appelable depuis l'interface sur le code du main.
// L'interface n'a accès QU'À ces fonctions (voir preload/index.ts).

import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import type { GamePatch, Settings } from '@shared/types'
import { IPC } from '@shared/ipc'
import * as library from './library'
import * as sgdb from './steamgriddb'
import { launchGame, killRunningGame } from './gameLauncher'
import { getSettings, saveSettings } from './settings'
import { findSteamExe, listSteamGames } from './steamLibrary'
import { registerKillShortcut } from './shortcuts'
import { checkForUpdates, downloadUpdate, installUpdate } from './updater'

export function registerIpcHandlers(hub: BrowserWindow): void {
  // --- Bibliothèque ---
  ipcMain.handle(IPC.getGames, () => library.getGames())

  ipcMain.handle(IPC.pickExecutable, async () => {
    const result = await dialog.showOpenDialog(hub, {
      title: 'Choisir un jeu ou un programme',
      properties: ['openFile'],
      filters: [{ name: 'Programmes et raccourcis', extensions: ['exe', 'lnk'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.addGame, (_event, path: string) => library.addGameFromPath(path))
  ipcMain.handle(IPC.updateGame, (_event, id: string, patch: GamePatch) => {
    // On ne laisse passer que les champs modifiables depuis l'interface
    const { name, args, forceFullscreen, skipLauncher } = patch
    const safe: GamePatch = {}
    if (typeof name === 'string' && name.trim()) safe.name = name.trim()
    if (typeof args === 'string') safe.args = args
    if (typeof forceFullscreen === 'boolean') safe.forceFullscreen = forceFullscreen
    if (typeof skipLauncher === 'boolean') safe.skipLauncher = skipLauncher
    return library.updateGame(id, safe)
  })
  ipcMain.handle(IPC.removeGame, (_event, id: string) => library.removeGame(id))

  // --- Jeux Steam ---
  ipcMain.handle(IPC.steamListGames, () => {
    const known = new Set(library.getGames().map((g) => g.steamAppId).filter((id): id is number => !!id))
    return listSteamGames(known)
  })
  ipcMain.handle(IPC.steamAddGames, (_event, appIds: number[]) => {
    const steamExe = findSteamExe()
    if (!steamExe) throw new Error("Steam n'est pas installé sur ce PC.")
    // On relit la liste nous-mêmes : l'interface n'envoie que des numéros, jamais des chemins
    const wanted = new Set(appIds.filter((id) => Number.isInteger(id)))
    const entries = listSteamGames(new Set()).filter((g) => wanted.has(g.appId))
    return library.addSteamGames(entries, steamExe)
  })

  // --- Lancement ---
  ipcMain.handle(IPC.launchGame, async (_event, id: string) => {
    const game = library.getGame(id)
    if (!game) throw new Error('Jeu introuvable.')
    await launchGame(game)
    library.updateGame(id, { lastPlayedAt: new Date().toISOString() })
  })
  ipcMain.handle(IPC.killGame, () => killRunningGame())

  // --- SteamGridDB ---
  // Recherche avec correction automatique du nom si rien n'est trouvé
  ipcMain.handle(IPC.sgdbSearch, (_event, term: string) => sgdb.smartSearch(term))
  ipcMain.handle(IPC.sgdbGrids, (_event, sgdbId: number) => sgdb.getGrids(sgdbId))
  ipcMain.handle(IPC.sgdbSetCover, (_event, gameId: string, url: string, sgdbId: number) =>
    sgdb.setCover(gameId, url, sgdbId)
  )
  ipcMain.handle(IPC.sgdbAutoCover, (_event, gameId: string) => sgdb.autoCover(gameId))

  // --- Paramètres ---
  ipcMain.handle(IPC.getSettings, () => getSettings())
  ipcMain.handle(IPC.saveSettings, (_event, patch: Partial<Settings>) => {
    if (patch.killShortcut !== undefined && patch.killShortcut !== getSettings().killShortcut) {
      if (!registerKillShortcut(patch.killShortcut)) {
        registerKillShortcut(getSettings().killShortcut) // on remet l'ancien
        throw new Error(`Raccourci "${patch.killShortcut}" invalide ou déjà utilisé par une autre appli.`)
      }
    }
    return saveSettings(patch)
  })

  // --- Fenêtre du hub ---
  ipcMain.handle(IPC.toggleFullscreen, () => {
    hub.setFullScreen(!hub.isFullScreen())
    return hub.isFullScreen()
  })
  ipcMain.handle(IPC.setFullscreen, (_event, value: boolean) => hub.setFullScreen(value))

  // --- Mise à jour ---
  ipcMain.handle(IPC.checkUpdate, () => checkForUpdates())
  ipcMain.handle(IPC.downloadUpdate, () => downloadUpdate())
  ipcMain.handle(IPC.installUpdate, () => installUpdate())

  ipcMain.handle(IPC.getVersion, () => app.getVersion())
}
