// La fenêtre du hub (l'interface de Gamer Room).
//
// Quand l'option « Compter le temps de jeu en dehors de l'appli » est activée, fermer le hub
// DÉTRUIT sa fenêtre (pour libérer la mémoire) mais Gamer Room continue de tourner près de l'horloge.
// La fenêtre est recréée quand on rouvre le hub. C'est pourquoi les autres modules ne gardent jamais
// la fenêtre de côté : ils la demandent à getHub() au moment où ils en ont besoin.

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { getSettings } from './settings'

let hub: BrowserWindow | null = null

/** La fenêtre du hub, ou null si elle est fermée (Gamer Room tourne alors en arrière-plan). */
export function getHub(): BrowserWindow | null {
  return hub && !hub.isDestroyed() ? hub : null
}

/** Envoie un message à l'interface (ignoré si le hub est fermé). */
export function sendToHub(channel: string, payload: unknown): void {
  getHub()?.webContents.send(channel, payload)
}

/** Crée la fenêtre du hub. Elle s'affiche toute seule une fois prête. */
export function createHub(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
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
    if (getSettings().startFullscreen) window.setFullScreen(true)
    window.show()
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
