// Réglages de défilement (molette, glisser à la souris, manette, son) et leurs valeurs par défaut.
// Partagé entre main (settings.json) et l'interface (qui en a besoin avant d'avoir lu les paramètres).
import type { Settings } from './types'

/** Uniquement les paramètres qui concernent le défilement. */
export type ScrollSettings = Pick<
  Settings,
  | 'wheelLevel'
  | 'wheelAcceleration'
  | 'dragScroll'
  | 'dragSensitivity'
  | 'gamepadSpeed'
  | 'gamepadAcceleration'
  | 'scrollSound'
  | 'scrollSoundVolume'
>

/** Par défaut : vitesse "Moyen" sans accélération (le comportement d'origine), petit clic à volume moyen. */
export const DEFAULT_SCROLL_SETTINGS: ScrollSettings = {
  wheelLevel: 3,
  wheelAcceleration: false,
  dragScroll: true,
  dragSensitivity: 3,
  gamepadSpeed: 5,
  gamepadAcceleration: false,
  scrollSound: true,
  scrollSoundVolume: 5
}
