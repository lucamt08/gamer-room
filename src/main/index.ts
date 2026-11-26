// Point d'entrée du processus principal (main) : c'est le premier code exécuté.
// Il crée la fenêtre du hub et branche tous les modules.

import { app, globalShortcut } from 'electron'
import { IPC } from '@shared/ipc'
import { registerCoverSchemeAsPrivileged, handleCoverProtocol } from './covers'
import { registerIpcHandlers } from './ipc'
import { initGameLauncher } from './gameLauncher'
import { getSettings } from './settings'
import { registerKillShortcut } from './shortcuts'
import { initUpdater } from './updater'
import { fixLauncherNamesAtStartup } from './launchLearning'
import { createHub, sendToHub, showHub } from './hub'
import { applyBackgroundMode, isBackgroundMode, startedHidden } from './background'
import { savePlaytimeNow, startPlaytimeTracker } from './playtimeTracker'

// Une seule instance du hub à la fois : si on le relance, on remet l'existant au premier plan.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// Doit être fait AVANT que l'appli soit prête
registerCoverSchemeAsPrivileged()

// Gamer Room relancée (raccourci, menu Démarrer…) alors qu'elle tourne déjà : on ouvre le hub
app.on('second-instance', () => showHub())

app.whenReady().then(() => {
  handleCoverProtocol()

  registerIpcHandlers()
  initGameLauncher((state) => sendToHub(IPC.runningState, state))
  initUpdater((status) => sendToHub(IPC.updateStatus, status))

  // Jeux qui portent encore le nom de leur launcher : on cherche leur vrai nom une fois l'interface prête
  const fixNames = (): void => {
    fixLauncherNamesAtStartup((game) => sendToHub(IPC.gameUpdated, game))
  }
  // Lancée par Windows au démarrage du PC : on reste discrète, près de l'horloge, sans ouvrir le hub
  if (startedHidden()) {
    fixNames()
  } else {
    createHub().webContents.once('did-finish-load', fixNames)
  }

  // Compteur de temps de jeu + icône près de l'horloge / démarrage avec Windows (si l'option est activée)
  startPlaytimeTracker((game) => sendToHub(IPC.gameUpdated, game))
  applyBackgroundMode()

  if (!registerKillShortcut(getSettings().killShortcut)) {
    console.warn(`[main] Raccourci "${getSettings().killShortcut}" indisponible`)
  }
})

// Croix du hub : on quitte, sauf en mode arrière-plan (Gamer Room continue de compter le temps de jeu)
app.on('window-all-closed', () => {
  if (!isBackgroundMode()) app.quit()
})

// Avant de quitter : on enregistre le temps de jeu compté depuis la dernière minute
app.on('before-quit', () => savePlaytimeNow())
app.on('will-quit', () => globalShortcut.unregisterAll())
