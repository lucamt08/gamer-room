// La fenêtre du hub (l'interface de Gamer Room).
//
// Quand l'option « Compter le temps de jeu en dehors de l'appli » est activée, fermer le hub
// DÉTRUIT sa fenêtre (pour libérer la mémoire) mais Gamer Room continue de tourner près de l'horloge.
// La fenêtre est recréée quand on rouvre le hub. C'est pourquoi les autres modules ne gardent jamais
// la fenêtre de côté : ils la demandent à getHub() au moment où ils en ont besoin.

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { getSettings } from './settings'
import * as wm from './windowManager'

let hub: BrowserWindow | null = null

/** La fenêtre du hub, ou null si elle est fermée (Gamer Room tourne alors en arrière-plan). */
export function getHub(): BrowserWindow | null {
  return hub && !hub.isDestroyed() ? hub : null
}

/** Envoie un message à l'interface (ignoré si le hub est fermé). */
export function sendToHub(channel: string, payload: unknown): void {
  getHub()?.webContents.send(channel, payload)
}

/**
 * Crée la fenêtre du hub. Elle s'affiche toute seule une fois prête.
 * `fullscreen` : forcer le plein écran (bouton Guide / PS), sinon on suit le paramètre « Démarrer en plein écran ».
 */
export function createHub(fullscreen = false): BrowserWindow {
  const startFullscreen = fullscreen || getSettings().startFullscreen
  const window = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    // Plein écran dès la création : sinon on voit une seconde la fenêtre normale (sa barre en haut)
    // avant qu'elle passe en plein écran
    fullscreen: startFullscreen,
    show: false,
    backgroundColor: '#0d0f14',
    autoHideMenuBar: true,
    title: 'Gamer Room',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Sécurité Electron de base :
      contextIsolation: true, // l'interface ne voit pas les objets du preload directement
      nodeIntegration: false, // l'interface n'a PAS accès à Node.js
      sandbox: true
    }
  })

  window.once('ready-to-show', () => {
    if (startFullscreen && !window.isFullScreen()) window.setFullScreen(true)
    window.show()
    if (fullscreen) wm.bringToFront(wm.hwndFromBuffer(window.getNativeWindowHandle()))
  })

  // Les liens externes (ex. site SteamGridDB) s'ouvrent dans le navigateur, pas dans le hub
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // En développement, electron-vite fournit une adresse locale avec rechargement à chaud
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    if (hub === window) hub = null
  })
  hub = window
  return window
}

/** Affiche le hub (en le recréant s'il a été fermé) et le met au premier plan. */
export function showHub(): void {
  const window = getHub()
  if (!window) {
    createHub() // il s'affichera tout seul une fois prêt
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * Remet le hub devant les autres fenêtres, sans changer son mode (plein écran ou non).
 * Sert pendant le lancement d'un jeu : un launcher qui s'ouvre passe derrière Gamer Room (voir gameLauncher.ts).
 */
export function bringHubToFront(): void {
  const window = getHub()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  // Windows empêche une appli en arrière-plan de prendre le focus : on utilise l'astuce de windowManager
  wm.bringToFront(wm.hwndFromBuffer(window.getNativeWindowHandle()))
  window.focus()
}

/**
 * Bouton Guide / PS de la manette : ouvre le hub en plein écran, devant tout le reste
 * (même si Gamer Room était seulement près de l'horloge, ou si un jeu est au premier plan).
 * Le bureau ne doit jamais se voir : si le jeu se réduit en perdant la main, le hub est déjà là, devant.
 */
export function showHubFullscreen(): void {
  const window = getHub()
  if (!window) {
    createHub(true)
    return
  }
  if (window.isMinimized()) window.restore()
  // Hub déjà affiché mais derrière le jeu (voir gameLauncher.ts) : Windows refuse de lui donner la main
  // (barre des tâches visible, manette qui ne répond plus). En revanche, il active une fenêtre qui
  // RÉAPPARAÎT : on le cache puis on le réaffiche (invisible pour l'œil, il était derrière le jeu).
  if (window.isVisible() && !window.isFocused()) window.hide()
  // Un jeu au premier plan empêche parfois Windows de nous laisser passer devant : le hub passe
  // « toujours au-dessus » le temps d'apparaître, puis redevient une fenêtre normale
  window.setAlwaysOnTop(true, 'screen-saver')
  setTimeout(() => {
    if (!window.isDestroyed()) window.setAlwaysOnTop(false)
  }, 800)
  // Fenêtre pas encore en plein écran : on la rend invisible le temps du passage en plein écran,
  // pour ne pas voir la fenêtre normale (et sa barre en haut) pendant une fraction de seconde
  if (!window.isFullScreen()) {
    window.setOpacity(0)
    const reveal = (): void => {
      if (!window.isDestroyed()) window.setOpacity(1)
    }
    window.once('enter-full-screen', () => setTimeout(reveal, 50))
    setTimeout(reveal, 600) // au cas où l'événement n'arrive pas
    window.setFullScreen(true)
  }
  window.show()
  // Windows empêche une appli en arrière-plan de prendre le focus : on utilise l'astuce de windowManager
  wm.bringToFront(wm.hwndFromBuffer(window.getNativeWindowHandle()))
  window.focus()
}
