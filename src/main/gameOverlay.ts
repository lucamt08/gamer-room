// Menu en jeu : un panneau sur le côté droit de l'écran, par-dessus le jeu.
// Il s'ouvre avec un appui long sur le bouton Guide / PS (voir guideButton.ts).
//
// C'est une 2e fenêtre Electron, transparente, sans bordure et « toujours au-dessus », qui couvre
// l'écran du jeu : à gauche le jeu reste visible (assombri), à droite le menu. Elle charge la même
// interface que le hub, avec « #overlay » à la fin de l'adresse (voir renderer/src/main.tsx).
//
// ⚠️ Ça marche avec le plein écran fenêtré sans bordure (ce que Gamer Room force).
//    Un jeu en plein écran EXCLUSIF passe au-dessus de tout : le menu ne peut pas s'afficher par-dessus.
//
// La fenêtre n'est créée qu'une fois puis gardée cachée : la réafficher est instantané.

import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { OverlayAction, OverlayInfo } from '@shared/types'
import * as wm from './windowManager'
import { getPlayingGame, killRunningGame } from './gameLauncher'

let overlay: BrowserWindow | null = null
/** La fenêtre a fini de charger l'interface ? (avant, on ne peut pas lui envoyer de message) */
let ready = false
/** Infos à envoyer dès que l'interface du menu est chargée (première ouverture). */
let pendingInfo: OverlayInfo | null = null

function createOverlay(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true, // pas d'icône dans la barre des tâches
    hasShadow: false,
    title: 'Gamer Room — menu',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false // le menu doit réagir tout de suite, même juste après avoir été caché
    }
  })
  // Au-dessus du jeu (niveau le plus haut que Windows accepte pour une fenêtre normale)
  window.setAlwaysOnTop(true, 'screen-saver')

  window.webContents.once('did-finish-load', () => {
    ready = true
    if (pendingInfo) window.webContents.send(IPC.overlayOpened, pendingInfo)
    pendingInfo = null
  })
  // Le menu perd le focus (Alt+Tab, clic ailleurs…) : on le ferme
  window.on('blur', () => hideOverlay(false))
  window.on('closed', () => {
    overlay = null
    ready = false
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#overlay`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
  }
  overlay = window
  return window
}

export function isOverlayOpen(): boolean {
  return !!overlay && !overlay.isDestroyed() && overlay.isVisible()
}

/** Ouvre le menu par-dessus le jeu en cours. Ne fait rien si aucun jeu n'est « en jeu ». */
export function showOverlay(): void {
  const playing = getPlayingGame()
  if (!playing) return
  const window = overlay && !overlay.isDestroyed() ? overlay : createOverlay()

  // On couvre l'écran où se trouve le jeu (Windows compte en pixels réels, Electron en pixels « logiques »)
  const monitor = playing.gameWindow ? wm.getMonitorRectForWindow(playing.gameWindow) : null
  const display = monitor
    ? screen.getDisplayNearestPoint(
        screen.screenToDipPoint({ x: (monitor.left + monitor.right) / 2, y: (monitor.top + monitor.bottom) / 2 })
      )
    : screen.getPrimaryDisplay()
  window.setBounds(display.bounds)

  const info: OverlayInfo = { game: playing.game, startedAt: playing.startedAt }
  if (ready) window.webContents.send(IPC.overlayOpened, info)
  else pendingInfo = info

  window.show()
  window.setAlwaysOnTop(true, 'screen-saver')
  // Le jeu a le focus : on le lui prend (astuce de windowManager), pour que la manette et le clavier
  // pilotent le menu (et que la plupart des jeux se mettent en pause ou ignorent la manette)
  wm.bringToFront(wm.hwndFromBuffer(window.getNativeWindowHandle()))
  window.focus()
}

/** Ferme le menu. `refocusGame` : redonner le focus au jeu (sinon on laisse Windows faire). */
export function hideOverlay(refocusGame = true): void {
  if (!isOverlayOpen()) return
  overlay!.hide()
  const playing = getPlayingGame()
  if (refocusGame && playing?.gameWindow && wm.windowExists(playing.gameWindow)) wm.bringToFront(playing.gameWindow)
}

export function toggleOverlay(): void {
  if (isOverlayOpen()) hideOverlay()
  else showOverlay()
}

/** Branche les choix du menu. Seule la fenêtre du menu a le droit de les envoyer. */
export function registerOverlayIpc(): void {
  ipcMain.handle(IPC.overlayAction, (event, action: OverlayAction) => {
    if (!overlay || event.sender !== overlay.webContents) return
    const playing = getPlayingGame()
    switch (action) {
      case 'resume':
        hideOverlay()
        break
      case 'fullscreen':
        // Le jeu a remis sa bordure ou changé de taille : on réapplique le plein écran sans bordure
        hideOverlay(false)
        if (playing?.gameWindow) wm.makeBorderlessFullscreen(playing.gameWindow)
        break
      case 'quit':
        hideOverlay(false)
        killRunningGame() // réaffiche le hub
        break
    }
  })
}
