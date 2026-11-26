// Mode « arrière-plan » : option « Compter le temps de jeu en dehors de l'appli ».
//
// Quand elle est activée :
//  - Gamer Room démarre avec Windows, sans ouvrir de fenêtre (argument --hidden) ;
//  - une icône apparaît près de l'horloge (zone de notification) : clic = ouvrir le hub,
//    clic droit → « Quitter » = fermer vraiment Gamer Room ;
//  - la croix du hub ferme la fenêtre mais Gamer Room continue de compter le temps de jeu.
// Quand elle est désactivée, tout redevient comme avant : la croix quitte l'appli.

import { app, Menu, nativeImage, Tray } from 'electron'
import iconPath from '../../build/icon.png?asset'
import { getSettings } from './settings'
import { getHub, showHub } from './hub'

/** Argument ajouté au lancement automatique avec Windows : on démarre sans ouvrir le hub. */
export const HIDDEN_ARG = '--hidden'

let tray: Tray | null = null

/** L'option « compter en dehors de l'appli » est-elle activée ? */
export function isBackgroundMode(): boolean {
  return getSettings().trackOutsideApp
}

/** Gamer Room a-t-elle été lancée par Windows au démarrage du PC ? (on n'ouvre alors pas le hub) */
export function startedHidden(): boolean {
  return isBackgroundMode() && process.argv.includes(HIDDEN_ARG)
}

/**
 * Applique l'option : démarrage avec Windows + icône près de l'horloge.
 * À appeler au démarrage et quand on change l'option dans les paramètres.
 */
export function applyBackgroundMode(): void {
  const enabled = isBackgroundMode()

  // Démarrage avec Windows (seulement pour l'appli installée : en développement,
  // Windows lancerait Electron tout seul, sans notre code)
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] })
  } else if (enabled) {
    console.log("[arrière-plan] En développement, le démarrage avec Windows n'est pas activé")
  }

  if (enabled && !tray) createTray()
  if (!enabled && tray) {
    tray.destroy()
    tray = null
    // Option désactivée alors que le hub est fermé : plus rien à faire tourner
    if (!getHub()) app.quit()
  }
}

/** Crée l'icône près de l'horloge, avec son menu (clic droit). */
function createTray(): void {
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 })
  tray = new Tray(icon)
  tray.setToolTip('Gamer Room — compte ton temps de jeu')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir Gamer Room', click: () => showHub() },
      { type: 'separator' },
      { label: 'Quitter Gamer Room', click: () => app.quit() }
    ])
  )
  tray.on('click', () => showHub())
}
