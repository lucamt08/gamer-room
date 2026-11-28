// Le carrousel : une rangée de boîtes de jeux, le jeu sélectionné au centre et de face,
// les autres rangés de chaque côté, posés sur un sol brillant qui les reflète.
// Les boîtes sont dessinées en 3D par la carte graphique (WebGL) : voir shelf3d/ShelfScene.ts.
// Navigation : flèches / manette (gérées dans App.tsx), molette de la souris (voir input/useWheelScroll.ts)
// ou glisser à la souris (voir input/useDragScroll.ts). Un clic sur une boîte de côté la met au centre ;
// un clic sur la boîte du centre ouvre ses détails (GameDetails.tsx).
// On lance un jeu avec le bouton « Jouer » (dans App.tsx).
import { forwardRef, useEffect, useRef, type WheelEvent } from 'react'
import type { Game } from '@shared/types'
import type { ScrollSettings } from '@shared/scroll'
import { useWheelScroll, WHEEL_LEVELS } from '../input/useWheelScroll'
import { useDragScroll } from '../input/useDragScroll'
import {
  DRAG_COAST_TIME,
  DRAG_FLICK_SPEED,
  useMomentum,
  WHEEL_COAST_TIME,
  WHEEL_FLICK_NOTCHES,
  WHEEL_FLICK_SPEED
} from '../input/useMomentum'
import { ShelfScene } from '../shelf3d/ShelfScene'

interface Props {
  games: Game[]
  selectedIndex: number
  onSelect: (index: number) => void
  /** Clic sur la boîte du centre : ouvre le panneau de détails de ce jeu (voir GameDetails.tsx). */
  onOpen: (index: number) => void
  /** Réglages de la molette et du glisser (venant des Paramètres). */
  scroll: ScrollSettings
}

const Shelf = forwardRef<HTMLDivElement, Props>(function Shelf({ games, selectedIndex, onSelect, onOpen, scroll }, ref) {
  // Jeu visé par la molette / le glisser. On le garde à part car plusieurs mouvements
  // peuvent arriver avant que l'interface ait eu le temps de se redessiner.
  const target = useRef(selectedIndex)
  /** Derniers jeux demandés par l'étagère elle-même (molette, glisser, élan), pour les reconnaître. */
  const requested = useRef<number[]>([selectedIndex])
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // Élément invisible qui donne la largeur d'une boîte (variable CSS --box-width, qui dépend de la fenêtre)
  const probe = useRef<HTMLDivElement>(null)
  const scene = useRef<ShelfScene | null>(null)
  const empty = games.length === 0

  // Création de la scène 3D, et mise à la bonne taille quand la fenêtre change
  useEffect(() => {
    if (empty || !canvas.current || !stage.current || !probe.current) return
    const shelf = new ShelfScene(canvas.current)
    scene.current = shelf
    const resize = (): void => {
      const boxWidth = probe.current?.offsetWidth ?? 200
      const boxHeight = boxWidth * 1.5
      const stageHeight = boxHeight * 1.32 + 24
      // Le canvas dépasse sous l'étagère pour laisser la place au reflet
      const height = stageHeight + boxHeight * 0.6
      canvas.current!.style.height = `${height}px`
      shelf.setSize(stage.current!.clientWidth, height, stageHeight, boxWidth)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(stage.current)
    return () => {
      observer.disconnect()
      shelf.dispose()
      scene.current = null
    }
  }, [empty])

  // Hub au premier plan ? Sinon (derrière un jeu pendant la partie, autre fenêtre devant), la scène arrête
  // de se dessiner : elle ne prend plus rien à la carte graphique (voir ShelfScene.setActive)
  useEffect(() => {
    if (empty) return
    const update = (): void => scene.current?.setActive(document.visibilityState === 'visible' && document.hasFocus())
    update()
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [empty])

  // Sélection puis jeux transmis à la scène (après sa création ci-dessus, grâce à l'ordre des effets)
  useEffect(() => {
    // La sélection a changé autrement (clavier, manette…) : on arrête une éventuelle glissade.
    // (React peut afficher un jeu demandé par l'étagère avec un peu de retard : ceux-là ne comptent pas)
    if (!requested.current.includes(selectedIndex)) momentum.stop()
    target.current = selectedIndex
    scene.current?.setSelected(selectedIndex)
  }, [selectedIndex, empty])

  useEffect(() => {
    scene.current?.setGames(games)
  }, [games, empty])

  /** Avance de `steps` jeux (négatif = vers la gauche), sans sortir de la liste. */
  const moveBy = (steps: number): void => {
    const next = Math.min(games.length - 1, Math.max(0, target.current + steps))
    if (next === target.current) return
    target.current = next
    requested.current = [...requested.current.slice(-31), next]
    // La scène est prévenue tout de suite, sans attendre que React redessine l'appli :
    // sinon, pendant un glisser, l'étagère reculerait d'un cran pendant une image (à-coup)
    scene.current?.setSelected(next)
    onSelect(next)
  }

  // Élan après un coup de souris ou de molette (voir input/useMomentum.ts)
  const momentum = useMomentum({
    count: games.length,
    current: () => target.current,
    select: (index) => moveBy(index - target.current),
    setOffset: (offset, active) => scene.current?.setDrag(offset, active)
  })
  const wheelTimer = useRef(0)
  const wheelBurst = useRef<{ t: number; notches: number }[]>([])

  const wheelScroll = useWheelScroll({
    speed: scroll.wheelLevel,
    acceleration: scroll.wheelAcceleration,
    // Chaque cran ajoute des jeux au mouvement en cours, sans jamais l'interrompre (voir useMomentum.ts)
    moveBy: (steps) => momentum.wheelBy(steps)
  })

  /**
   * Molette + élan. On mesure la vitesse de la MOLETTE elle-même (crans par seconde) pendant une « rafale »
   * (crans à moins de 150 ms d'écart), pas les jeux passés : avec la vitesse « 1 jeu / 3 crans », une molette
   * tournée vite ne fait passer que peu de jeux, mais c'est bien un « coup de molette ».
   * (Quand on tourne très vite, Chromium regroupe plusieurs crans en un seul événement : d'où ce comptage.)
   */
  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    wheelScroll(event)
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    const notches = (delta * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1)) / 100
    if (notches === 0) return
    const now = performance.now()
    const burst = wheelBurst.current
    const previous = burst[burst.length - 1]
    // Pause ou changement de sens : nouvelle rafale
    if (!previous || now - previous.t > 150 || Math.sign(notches) !== Math.sign(previous.notches)) burst.length = 0
    burst.push({ t: now, notches })
    // La molette s'arrête : si on la tournait vite, l'étagère continue un peu sur son élan
    clearTimeout(wheelTimer.current)
    wheelTimer.current = window.setTimeout(() => {
      const events = wheelBurst.current
      wheelBurst.current = []
      const total = events.reduce((sum, e) => sum + e.notches, 0)
      if (Math.abs(total) < WHEEL_FLICK_NOTCHES) return // quelques crans : pas d'élan
      // Vitesse sur la FIN de la rafale (200 ms) : si la molette (ou l'élan d'un pavé tactile) ralentissait
      // déjà, pas d'élan en plus
      const last = events[events.length - 1].t
      const recent = events.filter((e) => last - e.t <= 200)
      const span = Math.max(0.08, (last - recent[0].t) / 1000 + 0.04)
      const notchesPerSecond = recent.reduce((sum, e) => sum + e.notches, 0) / span
      if (Math.abs(notchesPerSecond) < WHEEL_FLICK_SPEED) return // molette tournée doucement
      // Élan en jeux, selon le réglage « Vitesse de la molette » (au moins un jeu, pour qu'il se voie).
      // Il PROLONGE le mouvement en cours (pas de nouvel élan qui couperait le premier).
      const level = WHEEL_LEVELS[Math.min(5, Math.max(1, Math.round(scroll.wheelLevel))) - 1]
      const extra = Math.max(1, Math.round(Math.abs(notchesPerSecond / level.notchesPerGame) * WHEEL_COAST_TIME))
      momentum.wheelBy(Math.sign(notchesPerSecond) * extra)
    }, 130)
  }
  const drag = useDragScroll({
    enabled: scroll.dragScroll,
    sensitivity: scroll.dragSensitivity,
    moveBy,
    // L'étagère suit le curseur entre deux crans (sinon elle avance par à-coups)
    onDrag: (offset, dragging) => {
      scene.current?.setDrag(offset, dragging)
      if (dragging) momentum.sample(target.current + offset)
    },
    // Lâché en plein mouvement : l'étagère glisse sur son élan. Lâché à l'arrêt (glisser précis) : non.
    onRelease: (offset) => {
      const speed = momentum.velocity()
      momentum.clearSamples()
      if (Math.abs(speed) < DRAG_FLICK_SPEED) return false
      momentum.fling(target.current + offset, speed, DRAG_COAST_TIME)
      return true
    }
  })

  if (empty) {
    return (
      <div className="shelf-empty">
        <p className="shelf-empty-title">Ta bibliothèque est vide</p>
        <p>
          Clique sur <strong>+ Ajouter</strong> ou glisse un <code>.exe</code> / raccourci <code>.lnk</code> dans
          la fenêtre.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={(element) => {
        stage.current = element
        if (typeof ref === 'function') ref(element)
        else if (ref) ref.current = element
      }}
      className="cf-stage"
      onWheel={onWheel}
      {...drag}
      onPointerMove={(event) => {
        drag.onPointerMove(event)
        const dragging = event.currentTarget.classList.contains('dragging')
        const hit = scene.current?.pointerMove(event.clientX, event.clientY, dragging) ?? -1
        // Main au survol d'une boîte (comme un lien)
        if (canvas.current) canvas.current.style.cursor = hit >= 0 && !dragging ? 'pointer' : ''
      }}
      onPointerDown={(event) => {
        // Un clic arrête l'étagère qui glisse (comme le doigt sur un téléphone)
        momentum.stop()
        momentum.clearSamples()
        drag.onPointerDown(event)
        if (event.button === 0) scene.current?.setPressed(true, event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        drag.onPointerUp(event)
        scene.current?.setPressed(false)
      }}
      onPointerLeave={() => scene.current?.pointerLeave()}
    >
      <div ref={probe} className="cf-probe" />
      {/* Halo de lumière derrière le jeu du centre */}
      {/* La "key" change à chaque jeu : le halo est recréé et refait son petit flash (le cran) */}
      <div className="cf-light" key={selectedIndex} />
      {/* Les boîtes et leur reflet sur le sol, en 3D */}
      <canvas
        ref={canvas}
        className="cf-canvas"
        onClick={(event) => {
          // (un clic qui termine un glisser est annulé avant d'arriver ici, voir useDragScroll.ts)
          const index = scene.current?.hitTest(event.clientX, event.clientY) ?? -1
          if (index < 0) return
          // Clic sur le jeu du centre : ses détails. Clic sur un jeu de côté : on le met au centre.
          if (index === selectedIndex) return onOpen(index)
          target.current = index
          scene.current?.setSelected(index)
          onSelect(index)
        }}
      />
      {/* Ligne d'horizon du sol */}
      <div className="cf-floor" />
    </div>
  )
})

export default Shelf
