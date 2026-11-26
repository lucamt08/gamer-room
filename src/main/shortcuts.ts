// Raccourci clavier GLOBAL (il marche même quand le jeu a le focus) pour
// forcer la fermeture du jeu en cours. Par défaut : Ctrl+Alt+F4.

import { globalShortcut } from 'electron'
import { killRunningGame } from './gameLauncher'

let current: string | null = null

/**
 * (Ré)enregistre le raccourci. Renvoie false si Windows refuse
 * (raccourci invalide ou déjà pris par une autre appli).
 */
export function registerKillShortcut(accelerator: string): boolean {
  if (current) globalShortcut.unregister(current)
  current = null
  try {
    const ok = globalShortcut.register(accelerator, () => killRunningGame())
    if (ok) current = accelerator
    return ok
  } catch {
    return false // format invalide, ex. "Ctrl+"
  }
}
