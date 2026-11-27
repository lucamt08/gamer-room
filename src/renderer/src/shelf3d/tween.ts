// Petites animations « de A vers B » pour l'étagère 3D (remplacent les transitions CSS d'avant).
// Une Tween garde une valeur qui glisse en douceur vers sa cible, avec une courbe d'accélération
// identique aux `cubic-bezier(...)` du CSS.

/** Courbe d'accélération façon CSS `cubic-bezier(x1, y1, x2, y2)` : renvoie une fonction t (0..1) → progression. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const curve = (a: number, b: number, t: number): number => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3
  const slope = (a: number, b: number, t: number): number =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t ** 2
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    // On cherche le t de la courbe qui donne cet x (méthode de Newton), puis on renvoie son y
    let t = x
    for (let i = 0; i < 8; i++) {
      const dx = curve(x1, x2, t) - x
      const d = slope(x1, x2, t)
      if (Math.abs(dx) < 1e-5 || d === 0) break
      t = Math.min(1, Math.max(0, t - dx / d))
    }
    return curve(y1, y2, t)
  }
}

export const EASE = cubicBezier(0.25, 0.1, 0.25, 1)
export const EASE_OUT = cubicBezier(0, 0, 0.58, 1)
export const EASE_IN_OUT = cubicBezier(0.42, 0, 0.58, 1)

/** Une valeur animée : `set()` change la cible, `value(now)` donne la valeur à l'instant `now` (ms). */
export class Tween {
  private from: number
  private to: number
  private start = 0
  private duration: number
  private ease: (t: number) => number

  constructor(initial: number, duration: number, ease: (t: number) => number = EASE) {
    this.from = initial
    this.to = initial
    this.duration = duration
    this.ease = ease
  }

  /** Nouvelle cible. Comme en CSS, on repart de la valeur actuelle (même au milieu d'une animation). */
  set(target: number, now: number, duration = this.duration, ease = this.ease): void {
    if (target === this.to) return
    this.from = this.value(now)
    this.to = target
    this.start = now
    this.duration = duration
    this.ease = ease
  }

  /** Saute directement à la valeur (sans animation). */
  jump(target: number): void {
    this.from = target
    this.to = target
  }

  get target(): number {
    return this.to
  }

  value(now: number): number {
    if (this.from === this.to || this.duration <= 0) return this.to
    const t = (now - this.start) / this.duration
    if (t >= 1) {
      this.from = this.to
      return this.to
    }
    return this.from + (this.to - this.from) * this.ease(Math.max(0, t))
  }

  /** Vrai tant que l'animation n'est pas finie. */
  moving(): boolean {
    return this.from !== this.to
  }
}
