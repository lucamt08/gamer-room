// Branche chaque fonction appelable depuis l'interface sur le code du main.
// L'interface n'a accès QU'À ces fonctions (voir preload/index.ts).

import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { GameInfo, GamePatch, Settings } from '@shared/types'
import { getGameInfo } from './gameInfo'
import { IPC } from '@shared/ipc'
import * as library from './library'
import * as sgdb from './steamgriddb'
import { launchGame, killRunningGame } from './gameLauncher'
import { installGame } from './steamInstalls'
import { addPcGames, listPcGames } from './pcGames/pcGames'
import { updateGameSizes } from './gameSizes'
import { getSettings, saveSettings } from './settings'
import { findSteamExe, listSteamGames } from './steamLibrary'
import { registerKillShortcut } from './shortcuts'
import { checkForUpdates, downloadUpdate, installUpdate } from './updater'
import { applyBackgroundMode } from './background'
import * as fws from './flawless'
import { isAlreadyInLibrary } from '@shared/duplicates'

/** La fenêtre qui a fait la demande (le hub). */
function windowOf(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw new Error('Fenêtre introuvable.')
  return window
}

export function registerIpcHandlers(): void {
  // --- Bibliothèque ---
  ipcMain.handle(IPC.getGames, () => library.getGames())

  ipcMain.handle(IPC.pickExecutable, async (event) => {
    const result = await dialog.showOpenDialog(windowOf(event), {
      title: 'Choisir un jeu ou un programme',
      properties: ['openFile'],
      filters: [{ name: 'Programmes et raccourcis', extensions: ['exe', 'lnk'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.addGame, (event, path: string) => {
    const game = library.addGameFromPath(path)
    // Taille du dossier du nouveau jeu, calculée en arrière-plan
    updateGameSizes((updated) => event.sender.send(IPC.gameUpdated, updated))
    return game
  })
  ipcMain.handle(IPC.updateGame, (_event, id: string, patch: GamePatch) => {
    // On ne laisse passer que les champs modifiables depuis l'interface
    const { name, args, forceFullscreen, skipLauncher, playtimeSeconds, fwsModule } = patch
    const safe: GamePatch = {}
    if (typeof name === 'string' && name.trim()) safe.name = name.trim()
    if (typeof args === 'string') safe.args = args
    if (typeof forceFullscreen === 'boolean') safe.forceFullscreen = forceFullscreen
    if (typeof skipLauncher === 'boolean') safe.skipLauncher = skipLauncher
    // Valeur de départ du compteur de temps de jeu (en secondes, jamais négative)
    if (typeof playtimeSeconds === 'number' && Number.isFinite(playtimeSeconds)) {
      safe.playtimeSeconds = Math.max(0, Math.round(playtimeSeconds))
    }
    // Correctif Flawless Widescreen : 'auto', 'off' ou la clé d'un correctif ("plugin/module")
    if (typeof fwsModule === 'string' && /^(auto|off|[\w.-]+\/[\w.-]+)$/.test(fwsModule)) safe.fwsModule = fwsModule
    return library.updateGame(id, safe)
  })
  ipcMain.handle(IPC.removeGame, (_event, id: string) => library.removeGame(id))

  // --- Jeux Steam ---
  ipcMain.handle(IPC.steamListGames, () => {
    const games = library.getGames()
    const known = new Set(games.map((g) => g.steamAppId).filter((id): id is number => !!id))
    // Un jeu déjà présent sous le même nom (ex. Rocket League ajouté depuis Epic) compte aussi comme déjà ajouté
    return listSteamGames(known).map((g) =>
      g.alreadyAdded || !isAlreadyInLibrary(g.name, g.installed, games) ? g : { ...g, alreadyAdded: true }
    )
  })
  ipcMain.handle(IPC.steamAddGames, (_event, appIds: number[]) => {
    const steamExe = findSteamExe()
    if (!steamExe) throw new Error("Steam n'est pas installé sur ce PC.")
    // On relit la liste nous-mêmes : l'interface n'envoie que des numéros, jamais des chemins
    const wanted = new Set(appIds.filter((id) => Number.isInteger(id)))
    const entries = listSteamGames(new Set()).filter((g) => wanted.has(g.appId))
    return library.addSteamGames(entries, steamExe)
  })

  // --- Jeux du PC (Epic, Battle.net, GOG, Riot, jeux sans launcher) ---
  ipcMain.handle(IPC.pcListGames, () => listPcGames())
  // L'interface n'envoie que des clés : on refait la recherche nous-mêmes (jamais de chemins venant de l'interface)
  ipcMain.handle(IPC.pcAddGames, (event, keys: string[]) => {
    const added = addPcGames(keys.filter((k) => typeof k === 'string'))
    // Taille du dossier des nouveaux jeux, calculée en arrière-plan
    updateGameSizes((updated) => event.sender.send(IPC.gameUpdated, updated))
    return added
  })
  // Ajouter un dossier où chercher des jeux (ex. E:\MesJeux), puis relancer la recherche
  ipcMain.handle(IPC.pcAddFolder, async (event) => {
    const result = await dialog.showOpenDialog(windowOf(event), {
      title: 'Dossier où sont rangés tes jeux',
      properties: ['openDirectory']
    })
    if (!result.canceled) {
      const folders = getSettings().gameFolders
      const folder = result.filePaths[0]
      if (!folders.some((f) => f.toLowerCase() === folder.toLowerCase())) saveSettings({ gameFolders: [...folders, folder] })
    }
    return listPcGames()
  })

  // --- Lancement ---
  ipcMain.handle(IPC.launchGame, async (_event, id: string) => {
    const game = library.getGame(id)
    if (!game) throw new Error('Jeu introuvable.')
    if (game.installed === false) throw new Error("Ce jeu n'est pas installé : clique sur « Installer ».")
    await launchGame(game)
    library.updateGame(id, { lastPlayedAt: new Date().toISOString() })
  })
  ipcMain.handle(IPC.killGame, () => killRunningGame())
  // Jeu Steam, Epic ou Riot pas installé : ouvre la fenêtre d'installation du magasin
  ipcMain.handle(IPC.installGame, (_event, id: string) => installGame(id))

  // Panneau de détails : fiche du jeu (page Steam ou Wikipédia, en cache) + succès Steam (voir gameInfo.ts)
  ipcMain.handle(IPC.gameInfo, async (_event, id: string): Promise<GameInfo> => {
    const game = library.getGame(id)
    return game ? getGameInfo(game) : { sheet: null, achievements: null }
  })

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
    const saved = saveSettings(patch)
    // Option « compter en dehors de l'appli » changée : démarrage avec Windows + icône près de l'horloge
    if (patch.trackOutsideApp !== undefined) applyBackgroundMode()
    return saved
  })

  // --- Fenêtre du hub ---
  ipcMain.handle(IPC.toggleFullscreen, (event) => {
    const hub = windowOf(event)
    hub.setFullScreen(!hub.isFullScreen())
    return hub.isFullScreen()
  })
  ipcMain.handle(IPC.setFullscreen, (event, value: boolean) => windowOf(event).setFullScreen(value))

  // --- Mise à jour ---
  ipcMain.handle(IPC.checkUpdate, () => checkForUpdates())
  ipcMain.handle(IPC.downloadUpdate, () => downloadUpdate())
  ipcMain.handle(IPC.installUpdate, () => installUpdate())

  // --- Flawless Widescreen ---
  ipcMain.handle(IPC.fwsGameInfo, (_event, gameId: string) => {
    const game = library.getGame(gameId)
    if (!game) throw new Error('Jeu introuvable.')
    return fws.getGameInfo(game)
  })
  ipcMain.handle(IPC.fwsStatus, () => fws.getStatus())
  // Crée les tâches administrateur : Windows affiche sa fenêtre d'autorisation (une seule fois)
  ipcMain.handle(IPC.fwsAuthorize, async () => {
    await fws.authorize()
    return fws.getStatus()
  })
  // Choisir le dossier de Flawless Widescreen à la main (s'il n'a pas été trouvé tout seul)
  ipcMain.handle(IPC.fwsPickFolder, async (event) => {
    const result = await dialog.showOpenDialog(windowOf(event), {
      title: 'Où est installé Flawless Widescreen ?',
      properties: ['openDirectory']
    })
    if (result.canceled) return fws.getStatus()
    const folder = fws.isValidFwsChoice(result.filePaths[0])
    if (!folder) throw new Error('FlawlessWidescreen.exe est introuvable dans ce dossier.')
    saveSettings({ fwsPath: folder })
    fws.forgetFwsFolder()
    return fws.getStatus()
  })

  ipcMain.handle(IPC.getVersion, () => app.getVersion())
}
