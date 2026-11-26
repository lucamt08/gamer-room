// Lit les manettes (Xbox, PlayStation…) avec la Gamepad API de Chromium et
// transforme les boutons en actions de navigation.
//
// La Gamepad API ne prévient pas quand on appuie sur un bouton : il faut
// "interroger" la manette en boucle (≈ 60 fois par seconde) et détecter
// nous-mêmes les changements.
//
// Disposition "standard" (identique Xbox / PlayStation dans Chromium) :
//   boutons 0 = A / Croix, 1 = B / Rond, 2 = X / Carré, 3 = Y / Triangle,
//           8 = Select / Share, 9 = Start / Options,
//           12 = haut, 13 = bas, 14 = gauche, 15 = droite (croix directionnelle)
//   axes    0 = stick gauche horizontal, 1 = stick gauche vertical

import { useEffect, useRef } from 'react'
import type { NavAction } from './actions'

const BUTTONS: Record<number, NavAction> = {
  0: 'confirm',
  1: 'back',
  2: 'cover',
  3: 'edit',
  8: 'add',
  9: 'settings',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right'
}

const DIRECTIONS: NavAction[] = ['up', 'down', 'left', 'right']
const STICK_DEADZONE = 0.5 // le stick doit être poussé à plus de 50 %
const REPEAT_DELAY = 350 // ms avant que la direction se répète quand on la maintient
/** Accélération : à chaque répétition, le délai est multiplié par ce nombre (plus petit = accélère plus vite). */
const ACCELERATION_FACTOR = 0.85
/** Accélération : délai minimum entre deux répétitions (ms). */
const MIN_REPEAT_RATE = 25

/** Réglages venant des Paramètres (onglet Manette). */
export interface GamepadOptions {
  /** Vitesse de 1 (lent) à 9 (rapide), 5 = moyen. */
  speed: number
  /** Accélérer quand on maintient la direction ? */
  acceleration: boolean
}

/** Délai (ms) entre deux répétitions selon la vitesse : 1 = 200 ms, 5 = 120 ms (moyen, d'origine), 9 = 40 ms. */
function repeatRateFor(speed: number): number {
  return 200 - (Math.min(9, Math.max(1, speed)) - 1) * 20
}

/** Direction actuellement indiquée par le stick gauche, ou null. */
function stickDirection(pad: Gamepad): NavAction | null {
  const [x = 0, y = 0] = pad.axes
  if (Math.abs(x) < STICK_DEADZONE && Math.abs(y) < STICK_DEADZONE) return null
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left'
  return y > 0 ? 'down' : 'up'
}

export function useGamepad(
  onAction: (action: NavAction) => void,
  enabled: boolean,
  options: GamepadOptions
): void {
  const handler = useRef(onAction)
  handler.current = onAction
  // Les réglages sont relus à chaque image : pas besoin de relancer la boucle quand ils changent
  const settings = useRef(options)
  settings.current = options

  useEffect(() => {
    if (!enabled) return
    let frame = 0
    // Actions "enfoncées" à l'image précédente, et moment du prochain déclenchement pour les directions
    let previous = new Set<NavAction>()
    const nextRepeat = new Map<NavAction, number>()
    // Délai actuel entre deux répétitions, par direction (il diminue avec l'accélération)
    const currentRate = new Map<NavAction, number>()

    const loop = (): void => {
      frame = requestAnimationFrame(loop)
      // On ignore la manette si la fenêtre n'a pas le focus (ex. un jeu est lancé)
      if (!document.hasFocus()) {
        previous = new Set()
        return
      }

      const pressed = new Set<NavAction>()
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue
        pad.buttons.forEach((button, index) => {
          const action = BUTTONS[index]
          if (action && button.pressed) pressed.add(action)
        })
        const stick = stickDirection(pad)
        if (stick) pressed.add(stick)
      }

      const now = performance.now()
      for (const action of pressed) {
        if (!previous.has(action)) {
          // Nouvel appui
          handler.current(action)
          if (DIRECTIONS.includes(action)) {
            nextRepeat.set(action, now + REPEAT_DELAY)
            currentRate.set(action, repeatRateFor(settings.current.speed))
          }
        } else if (DIRECTIONS.includes(action) && now >= (nextRepeat.get(action) ?? Infinity)) {
          // Direction maintenue : répétition
          handler.current(action)
          let rate = currentRate.get(action) ?? repeatRateFor(settings.current.speed)
          if (settings.current.acceleration) {
            rate = Math.max(MIN_REPEAT_RATE, rate * ACCELERATION_FACTOR) // de plus en plus vite
            currentRate.set(action, rate)
          }
          nextRepeat.set(action, now + rate)
        }
      }
      previous = pressed
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [enabled])
}
