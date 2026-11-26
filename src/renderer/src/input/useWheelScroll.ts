// Défilement du carrousel à la molette de la souris.
//
// Règle simple et RÉGULIÈRE : chaque cran de molette compte, toujours de la même façon.
// - On additionne les mouvements de molette ; un cran complet (WHEEL_NOTCH) = une "unité".
//   Ça marche avec une molette crantée, une molette libre, haute précision ou un pavé tactile.
// - La VITESSE (paramètre, niveau 1 à 5) dit combien de crans il faut par jeu, ou combien de jeux
//   par cran. Le niveau 3 (moyen) = exactement 1 jeu par cran.
// - Aucun cran n'est jamais ignoré ni "rattrapé" plus tard : même geste = même résultat.
// - Avec l'ACCÉLÉRATION activée (paramètre), si on enchaîne les crans très vite, chaque cran
//   avance de plus en plus de jeux. Dès qu'on ralentit, on revient à la normale.
import { useRef, type WheelEvent } from 'react'

/** Valeur d'un cran de molette sous Windows (deltaY vaut 100 par cran dans Electron). */
const WHEEL_NOTCH = 100

/**
 * Les 5 niveaux de vitesse. `notchesPerGame` = nombre de crans pour avancer d'UN jeu
 * (0.5 = 2 jeux par cran).
 */
export const WHEEL_LEVELS = [
  { name: 'Très lent (1 jeu / 3 crans)', notchesPerGame: 3 },
  { name: 'Lent (1 jeu / 2 crans)', notchesPerGame: 2 },
  { name: 'Moyen (1 jeu / cran)', notchesPerGame: 1 },
  { name: 'Rapide (2 jeux / cran)', notchesPerGame: 1 / 2 },
  { name: 'Très rapide (3 jeux / cran)', notchesPerGame: 1 / 3 }
]

/** Si deux crans arrivent à moins de ce délai (ms), on considère qu'on tourne "vite" (accélération). */
const FAST_SPIN_MS = 60
/** Nombre de crans rapides d'affilée avant d'aller un cran plus vite. */
const NOTCHES_PER_SPEED_UP = 4
/** Accélération maximale : la vitesse de base est multipliée au plus par ce nombre. */
const MAX_BOOST = 4
/** Après cette pause (ms), on oublie un éventuel morceau de cran entamé. */
const PAUSE_MS = 800
/** Sécurité : un seul évènement de molette ne peut pas compter pour plus de crans que ça. */
const MAX_NOTCHES_PER_EVENT = 3

interface Options {
  /** Niveau de vitesse, de 1 à 5 (paramètre "Vitesse de la molette"). */
  speed: number
  /** Accélérer quand on tourne vite ? */
  acceleration: boolean
  /** Fait avancer la sélection de `steps` jeux (négatif = vers la gauche). */
  moveBy: (steps: number) => void
}

export function useWheelScroll({ speed, acceleration, moveBy }: Options): (event: WheelEvent) => void {
  // Mémoire de la molette (une "ref" car ça ne doit pas redessiner l'interface)
  const state = useRef({ accumulated: 0, lastEvent: 0, lastNotch: 0, fastNotches: 0 })
  const level = WHEEL_LEVELS[Math.min(5, Math.max(1, Math.round(speed))) - 1]

  return (event: WheelEvent): void => {
    const s = state.current
    // Molette verticale ou horizontale (pavé tactile), on prend le mouvement le plus grand
    let delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (delta === 0) return
    // Certaines souris comptent en "lignes" ou en "pages" au lieu de pixels : on convertit
    if (event.deltaMode === 1) delta *= 40
    else if (event.deltaMode === 2) delta *= 800
    // Certains pilotes de souris envoient d'énormes valeurs quand on tourne vite : on plafonne
    const limit = WHEEL_NOTCH * MAX_NOTCHES_PER_EVENT
    delta = Math.max(-limit, Math.min(limit, delta))

    // Changement de sens ou longue pause : on repart de zéro
    const now = event.timeStamp
    const sameDirection = s.accumulated === 0 || Math.sign(delta) === Math.sign(s.accumulated)
    if (!sameDirection || now - s.lastEvent > PAUSE_MS) {
      s.accumulated = 0
      s.fastNotches = 0
    }
    s.lastEvent = now
    s.accumulated += delta

    // Distance (en "unités molette") qu'il faut pour avancer d'un jeu
    let unitsPerGame = WHEEL_NOTCH * level.notchesPerGame

    // Accélération : plus on enchaîne de crans rapides, plus un cran vaut de jeux
    if (acceleration && Math.abs(s.accumulated) >= WHEEL_NOTCH) {
      if (now - s.lastNotch < FAST_SPIN_MS) s.fastNotches += 1
      else s.fastNotches = 0
      s.lastNotch = now
      unitsPerGame /= Math.min(MAX_BOOST, 1 + Math.floor(s.fastNotches / NOTCHES_PER_SPEED_UP))
    }

    // Combien de jeux complets a-t-on accumulés ? On garde le reste pour la suite.
    // (le petit 0.000001 évite qu'un calcul à virgule donne 2,9999… au lieu de 3)
    const games = Math.trunc(s.accumulated / unitsPerGame + Math.sign(s.accumulated) * 1e-6)
    if (games === 0) return
    s.accumulated -= games * unitsPerGame
    moveBy(games)
  }
}
