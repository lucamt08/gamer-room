// Faire défiler le carrousel en "glissant" à la souris : on clique, on maintient,
// et on déplace la souris vers la gauche ou la droite (comme sur un téléphone).
//
// - Tant que la souris a bougé de moins de DRAG_THRESHOLD pixels, c'est un simple clic.
// - Au-delà, on "glisse" : tous les X pixels (selon la sensibilité), on avance d'un jeu.
// - Le clic qui suit un glisser est annulé, pour ne pas sélectionner une boîte par erreur.
import { useRef, type MouseEvent, type PointerEvent } from 'react'

/** Distance (px) à partir de laquelle un clic devient un glisser. */
const DRAG_THRESHOLD = 8
/** Pixels à glisser pour avancer d'un jeu, selon la sensibilité (1 = lent ... 5 = rapide). */
const PIXELS_PER_GAME = [140, 100, 70, 50, 35]

interface Options {
  /** Glisser activé ? (paramètre) */
  enabled: boolean
  /** Sensibilité, de 1 à 5. */
  sensitivity: number
  /** Fait avancer la sélection de `steps` jeux (négatif = vers la gauche). */
  moveBy: (steps: number) => void
  /**
   * Pendant le glisser : où en est la souris entre deux crans (fraction de jeu, -1..1),
   * pour que l'étagère suive le curseur en continu. Appelé avec (0, false) à la fin.
   */
  onDrag?: (offset: number, dragging: boolean) => void
  /**
   * Fin du glisser, avec où en était la souris entre deux crans. Renvoie `true` si l'étagère part
   * sur son élan (elle s'occupe alors de la suite), `false` pour s'arrêter au jeu le plus proche.
   */
  onRelease?: (offset: number) => boolean
}

interface DragState {
  pointerId: number
  startX: number
  /** Position de la souris au dernier jeu avancé. */
  lastStepX: number
  /** Vrai une fois le seuil dépassé (on glisse vraiment). */
  active: boolean
}

export function useDragScroll({ enabled, sensitivity, moveBy, onDrag, onRelease }: Options) {
  const drag = useRef<DragState | null>(null)
  const justDragged = useRef(false)
  const pixelsPerGame = PIXELS_PER_GAME[Math.min(5, Math.max(1, Math.round(sensitivity))) - 1]

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    if (!enabled || event.button !== 0) return // clic gauche uniquement
    drag.current = { pointerId: event.pointerId, startX: event.clientX, lastStepX: event.clientX, active: false }
    justDragged.current = false
  }

  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    const d = drag.current
    if (!d || event.pointerId !== d.pointerId) return
    // Le bouton a été relâché sans qu'on reçoive le « relâché » (hors de la fenêtre, Alt+Tab…) :
    // on arrête le glisser, sinon le curseur reste en « main fermée »
    if ((event.buttons & 1) === 0) {
      if (d.active) onDrag?.(0, false) // l'étagère se recale sur le jeu sélectionné
      endDrag(event)
      return
    }

    if (!d.active) {
      if (Math.abs(event.clientX - d.startX) < DRAG_THRESHOLD) return
      // Le glisser commence : on "capture" la souris pour la suivre même hors du carrousel
      d.active = true
      d.lastStepX = event.clientX
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.classList.add('dragging')
    }

    // Glisser vers la gauche fait venir les jeux de droite (comme si on poussait l'étagère)
    const steps = Math.trunc((d.lastStepX - event.clientX) / pixelsPerGame)
    if (steps !== 0) {
      d.lastStepX -= steps * pixelsPerGame
      moveBy(steps)
    }
    onDrag?.((d.lastStepX - event.clientX) / pixelsPerGame, true)
  }

  function onPointerUp(event: PointerEvent<HTMLElement>): void {
    const d = drag.current
    if (!d?.active) {
      drag.current = null
      return
    }
    const rest = (d.lastStepX - event.clientX) / pixelsPerGame
    // Lâché en plein mouvement (un « coup » de souris) : l'étagère continue sur son élan (voir useMomentum.ts)
    if (!onRelease?.(rest)) {
      // Lâché à plus de la moitié du chemin vers le jeu suivant : on y va (comme un téléphone)
      if (Math.abs(rest) >= 0.5) moveBy(Math.sign(rest))
      onDrag?.(0, false)
    }
    justDragged.current = true
    endDrag(event)
  }

  /**
   * Fin du glisser, quelle qu'en soit la raison : on retire TOUJOURS la classe « dragging »
   * (curseur « main fermée »), même si le « relâché » n'est jamais arrivé.
   */
  function endDrag(event: PointerEvent<HTMLElement>): void {
    drag.current = null
    event.currentTarget.classList.remove('dragging')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // Windows a repris la souris (fenêtre qui perd le focus, jeu lancé…) : le glisser s'arrête
  function onLostPointerCapture(event: PointerEvent<HTMLElement>): void {
    if (!drag.current?.active) return
    onDrag?.(0, false) // l'étagère se recale sur le jeu sélectionné
    endDrag(event)
  }

  // Appelé AVANT les clics des boîtes : on annule le clic de fin de glisser
  function onClickCapture(event: MouseEvent<HTMLElement>): void {
    if (justDragged.current) {
      event.stopPropagation()
      justDragged.current = false
    }
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onLostPointerCapture, onClickCapture }
}
