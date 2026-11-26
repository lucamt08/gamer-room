// Point d'entrée du processus principal (main) : c'est le premier code exécuté.
// Il crée la fenêtre du hub et branche tous les modules.

import { app, BrowserWindow, globalShortcut, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { registerCoverSchemeAsPrivileged, handleCoverProtocol } from './covers'
import { registerIpcHandlers } from './ipc'
import { initGameLauncher } from './gameLauncher'
import { getSettings } from './settings'
import { registerKillShortcut } from './shortcuts'
import { initUpdater } from './updater'

// Une seule instance du hub à la fois : si on le relance, on remet l'existant au premier plan.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// Doit être fait AVANT que l'appli soit prête
registerCoverSchemeAsPrivileged()

let hub: BrowserWindow | null = null

function createHubWindow(): BrowserWindow {
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

  return window
}

app.on('second-instance', () => {
  if (hub) {
    if (hub.isMinimized()) hub.restore()
    hub.show()
    hub.focus()
  }
})

app.whenReady().then(() => {
  handleCoverProtocol()

  hub = createHubWindow()
  const send = (channel: string, payload: unknown): void => {
    if (hub && !hub.isDestroyed()) hub.webContents.send(channel, payload)
  }

  registerIpcHandlers(hub)
  initGameLauncher(hub, (state) => send(IPC.runningState, state))
  initUpdater((status) => send(IPC.updateStatus, status))

  if (!registerKillShortcut(getSettings().killShortcut)) {
    console.warn(`[main] Raccourci "${getSettings().killShortcut}" indisponible`)
  }
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
