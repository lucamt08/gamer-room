// L'élan (« inertie ») de l'étagère, comme sur un trackpad de Mac ou un téléphone :
//  - on lance l'étagère d'un coup de souris (glisser rapide puis lâcher) → elle continue de glisser
//    en ralentissant, puis s'arrête pile sur un jeu ;
//  - molette : chaque cran AJOUTE de la distance au même mouvement fluide (jamais d'arrêt net entre deux
//    crans), et un coup de molette rapide prolonge le mouvement d'un peu d'élan ;
//  - un glisser lent et précis (la souris s'arrête avant de lâcher) ne glisse PAS.
//
// Principe : une position exacte (avec virgule) s'approche d'un point d'arrivée en ralentissant
// (courbe « exponentielle »). Le point d'arrivée est toujours un jeu entier : on s'arrête pile dessus.
// Pendant le mouvement, on sélectionne le jeu le plus proche au fur et à mesure (le petit « clic » sonne
// à chaque jeu) et l'étagère 3D suit la position exacte.
import { useRef } from 'react'

/** On mesure la vitesse sur les dernières ms du mouvement. */
const VELOCITY_WINDOW_MS = 90
/** Vitesse minimale (jeux par seconde) pour partir sur son élan après un glisser. En dessous : glisser précis. */
export const DRAG_FLICK_SPEED = 2.5
/** Vitesse minimale de la molette (crans par seconde) pour ajouter de l'élan (on tourne vite, pas cran par cran). */
export const WHEEL_FLICK_SPEED = 12
/** Nombre minimal de crans d'affilée pour un « coup de molette ». */
export const WHEEL_FLICK_NOTCHES = 5
/** Durée « caractéristique » de la glissade (s) : distance d'élan ≈ vitesse × durée. */
export const DRAG_COAST_TIME = 0.32
export const WHEEL_COAST_TIME = 0.15
/** Molette : vitesse à laquelle l'étagère rejoint le jeu visé (plus grand = plus vif ; 10 ≈ arrivée en 0,3 s). */
const WHEEL_FOLLOW_RATE = 10
/** Élan maximal (en jeux), pour ne pas traverser toute la bibliothèque d'un coup. */
const MAX_COAST_GAMES = 12

interface Options {
  /** Nombre de jeux (pour s'arrêter au bout de l'étagère). */
  count: number
  /** Jeu sélectionné en ce moment. */
  current: () => number
  /** Sélectionne ce jeu. */
  select: (index: number) => void
  /** Décalage (en fraction de jeu) entre la position exacte et le jeu sélectionné, pour la scène 3D. */
  setOffset: (offset: number, active: boolean) => void
}

export function useMomentum({ count, current, select, setOffset }: Options) {
  const samples = useRef<{ t: number; p: number }[]>([])
  // Mouvement en cours : position exacte, point d'arrivée, vitesse d'approche, numéro d'animation
  const motion = useRef<{ position: number; end: number; rate: number; frame: number; last: number } | null>(null)
  const options = useRef({ count, current, select, setOffset })
  options.current = { count, current, select, setOffset }

  const clamp = (index: number): number => Math.max(0, Math.min(options.current.count - 1, index))

  /** Note la position (en jeux, avec virgule) pendant un mouvement, pour en calculer la vitesse. */
  function sample(position: number): void {
    const t = performance.now()
    samples.current.push({ t, p: position })
    // On ne garde que le dernier quart de seconde
    while (samples.current.length > 2 && t - samples.current[0].t > 250) samples.current.shift()
  }

  /** Vitesse (jeux par seconde) sur la fin du mouvement ; 0 si la souris s'est arrêtée avant de lâcher. */
  function velocity(windowMs = VELOCITY_WINDOW_MS): number {
    const now = performance.now()
    const recent = samples.current.filter((s) => now - s.t <= windowMs)
    if (recent.length < 2) return 0
    const first = recent[0]
    const last = recent[recent.length - 1]
    const dt = (last.t - first.t) / 1000
    return dt > 0.008 ? (last.p - first.p) / dt : 0
  }

  function clearSamples(): void {
    samples.current = []
  }

  /** Arrête le mouvement (nouvelle action de l'utilisateur : clic, clavier, manette). */
  function stop(): void {
    if (!motion.current) return
    cancelAnimationFrame(motion.current.frame)
    motion.current = null
    options.current.setOffset(0, false)
  }

  /** Une image du mouvement : on se rapproche du point d'arrivée, on sélectionne le jeu le plus proche. */
  function tick(now: number): void {
    const m = motion.current
    if (!m) return
    const dt = Math.min(0.1, (now - m.last) / 1000)
    m.last = now
    m.position = m.end - (m.end - m.position) * Math.exp(-m.rate * dt)
    const { current: getCurrent, select, setOffset } = options.current
    const nearest = clamp(Math.round(m.position))
    if (nearest !== getCurrent()) select(nearest)
    if (Math.abs(m.end - m.position) < 0.003) {
      motion.current = null
      if (getCurrent() !== m.end) select(m.end)
      setOffset(0, false)
      return
    }
    setOffset(m.position - getCurrent(), true)
    m.frame = requestAnimationFrame(tick)
  }

  /** Va vers `end` (un jeu) à la vitesse d'approche `rate`, en partant de `from` si rien ne bouge encore. */
  function moveTo(from: number, end: number, rate: number): void {
    const target = clamp(end)
    if (motion.current) {
      // Déjà en mouvement : on change seulement le point d'arrivée (le mouvement continue sans à-coup)
      motion.current.end = target
      motion.current.rate = rate
      return
    }
    if (Math.abs(target - from) < 0.003) {
      options.current.select(target)
      options.current.setOffset(0, false)
      return
    }
    const now = performance.now()
    motion.current = { position: from, end: target, rate, frame: 0, last: now }
    motion.current.frame = requestAnimationFrame(tick)
  }

  /**
   * Coup de souris : glissade depuis `from` (position avec virgule) à la vitesse `speed` (jeux/s).
   * Le point d'arrivée est calculé tout de suite (arrondi à un jeu) ; on choisit la vitesse d'approche
   * pour partir à peu près à la vitesse du geste.
   */
  function fling(from: number, speed: number, coastTime: number): void {
    stop()
    const travel = Math.max(-MAX_COAST_GAMES, Math.min(MAX_COAST_GAMES, speed * coastTime))
    const end = clamp(Math.round(from + travel))
    const distance = Math.abs(end - from)
    const rate = distance > 0.01 ? Math.max(2.5, Math.min(14, Math.abs(speed) / distance)) : 10
    moveTo(from, end, rate)
  }

  /** Molette : avance de `steps` jeux EN PLUS du mouvement en cours (sans l'interrompre). */
  function wheelBy(steps: number): void {
    const from = motion.current ? motion.current.position : options.current.current()
    const end = (motion.current ? motion.current.end : options.current.current()) + steps
    moveTo(from, end, WHEEL_FOLLOW_RATE)
  }

  return {
    sample,
    velocity,
    clearSamples,
    fling,
    wheelBy,
    stop,
    active: () => motion.current !== null
  }
}
