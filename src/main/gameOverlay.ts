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

import { app, BrowserWindow, desktopCapturer, ipcMain, screen, type Display } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { OverlayAction, OverlayInfo } from '@shared/types'
import * as wm from './windowManager'
import { getPlayingGame, killRunningGame, setGamePaused } from './gameLauncher'

let overlay: BrowserWindow | null = null
/** La fenêtre a fini de charger l'interface ? (avant, on ne peut pas lui envoyer de message) */
let ready = false
/** Infos à envoyer dès que l'interface du menu est chargée (première ouverture). */
let pendingInfo: OverlayInfo | null = null
/** Heure d'ouverture du menu (voir BLUR_GRACE). */
let openedAt = 0
/** Juste après l'ouverture, le menu reprend la main s'il la perd, au lieu de se fermer (ms). */
const BLUR_GRACE = 1500
/** Délai avant de figer le jeu : il a le temps de réagir à la perte de la main (pause, son coupé…) (ms). */
const PAUSE_DELAY = 300

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
  // Le menu perd le focus (Alt+Tab, clic ailleurs…) : on le ferme.
  // Sauf si c'est Gamer Room qui a pris la main : le hub reste derrière le jeu pendant la partie
  // (voir gameLauncher.ts), et Windows le réactive quand le jeu se réduit. Le menu reprend alors la main.
  // Pareil juste après l'ouverture (1,5 s) : le jeu ou Steam peuvent reprendre la main en réagissant au
  // bouton PS (le menu se refermait au moment où on relâchait le bouton).
  window.on('blur', () => {
    setTimeout(() => {
      if (!isOverlayOpen()) return
      const focused = BrowserWindow.getFocusedWindow()
      if (focused === window) return
      const foreground = wm.getForegroundWindow()
      const who = foreground ? wm.getWindowInfo(foreground) : null
      const justOpened = Date.now() - openedAt < BLUR_GRACE
      console.log(
        `[menu en jeu] Perd la main au profit de « ${focused ? 'Gamer Room' : (who?.title ?? '?')} »` +
          `${who ? ` (pid ${who.pid})` : ''}${justOpened ? ' : on la reprend' : ''}`
      )
      if (focused || justOpened) {
        wm.bringToFront(wm.hwndFromBuffer(window.getNativeWindowHandle()))
        window.focus()
      } else {
        hideOverlay(false)
      }
    }, 100)
  })
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

/**
 * Capture de l'écran où se trouve le jeu (sa dernière image), en JPEG. null si la capture échoue.
 * Prise AVANT d'ouvrir le menu : ensuite, certains jeux deviennent noirs ou se réduisent (Hades II).
 */
async function captureScreen(display: Display): Promise<string | null> {
  try {
    const size = {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) return null
    return `data:image/jpeg;base64,${source.thumbnail.toJPEG(85).toString('base64')}`
  } catch (error) {
    console.warn('[menu en jeu] Capture de l\'écran impossible', error)
    return null
  }
}

/** Le menu est en train de s'ouvrir (capture en cours) : on ignore un 2e appui. */
let opening = false

/** Ouvre le menu par-dessus le jeu en cours. Ne fait rien si aucun jeu n'est « en jeu ». */
export async function showOverlay(): Promise<void> {
  const playing = getPlayingGame()
  if (!playing || opening) return
  opening = true

  // On couvre l'écran où se trouve le jeu (Windows compte en pixels réels, Electron en pixels « logiques »)
  const monitor = playing.gameWindow ? wm.getMonitorRectForWindow(playing.gameWindow) : null
  const display = monitor
    ? screen.getDisplayNearestPoint(
        screen.screenToDipPoint({ x: (monitor.left + monitor.right) / 2, y: (monitor.top + monitor.bottom) / 2 })
      )
    : screen.getPrimaryDisplay()

  // La dernière image du jeu, prise avant que le menu lui prenne la main
  const background = await captureScreen(display)
  opening = false
  if (!getPlayingGame()) return // jeu fermé pendant la capture

  const window = overlay && !overlay.isDestroyed() ? overlay : createOverlay()
  window.setBounds(display.bounds)

  const info: OverlayInfo = { game: playing.game, startedAt: playing.startedAt, background: background ?? undefined }
  if (ready) window.webContents.send(IPC.overlayOpened, info)
  else pendingInfo = info

  openedAt = Date.now()
  window.show()
  window.setAlwaysOnTop(true, 'screen-saver')
  // Le jeu a le focus : on le lui prend (astuce de windowManager), pour que la manette et le clavier
  // pilotent le menu (et que la plupart des jeux se mettent en pause ou ignorent la manette)
  wm.bringToFront(wm.hwndFromBuffer(window.getNativeWindowHandle()))
  window.focus()
  // Le jeu est figé tant que le menu est ouvert : la manette ne pilote que le menu (voir setGamePaused).
  // Un court délai d'abord, pour qu'il ait le temps de réagir à la perte de la main.
  setTimeout(() => {
    if (isOverlayOpen()) setGamePaused(true)
  }, PAUSE_DELAY)
}

/** Ferme le menu. `refocusGame` : redonner le focus au jeu (sinon on laisse Windows faire). */
export function hideOverlay(refocusGame = true): void {
  if (!isOverlayOpen()) return
  setGamePaused(false) // le jeu repart
  overlay!.hide()
  const playing = getPlayingGame()
  if (refocusGame && playing?.gameWindow && wm.windowExists(playing.gameWindow)) wm.bringToFront(playing.gameWindow)
}

export function toggleOverlay(): void {
  if (isOverlayOpen()) hideOverlay()
  else void showOverlay()
}

/** Branche les choix du menu. Seule la fenêtre du menu a le droit de les envoyer. */
export function registerOverlayIpc(): void {
  ipcMain.handle(IPC.overlayAction, (event, action: OverlayAction) => {
    if (!overlay || event.sender !== overlay.webContents) return
    console.log(`[menu en jeu] Choix : ${action}`)
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
        // Comme fermer la fenêtre du jeu à la main (croix / Alt+F4) : le jeu se ferme proprement.
        // On lui rend la main, au cas où il demande « Voulez-vous vraiment quitter ? ».
        // Quand il est fermé, le hub (juste derrière, voir gameLauncher.ts) réapparaît tout seul.
        // Fenêtre du jeu inconnue : seule solution, la fermeture forcée.
        if (playing?.gameWindow && wm.windowExists(playing.gameWindow)) {
          hideOverlay(true)
          const sent = wm.requestCloseWindow(playing.gameWindow)
          console.log(`[menu en jeu] Demande de fermeture envoyée au jeu : ${sent ? 'oui' : 'non'}`)
        } else {
          hideOverlay(false)
          killRunningGame() // réaffiche le hub
        }
        break
    }
  })
}
