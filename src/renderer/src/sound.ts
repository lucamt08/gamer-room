// Petit "clic" net joué quand on passe d'une jaquette à l'autre, dans le style des menus de console :
// court, sec et propre, comme un bouton en plastique qui s'enclenche.
//
// Pas de fichier audio : le son est fabriqué à la volée avec la Web Audio API, en 3 couches :
//  1. le "tac" : un souffle ultra-court filtré autour de 4 kHz (le contact du bouton),
//  2. le "corps" : une note claire qui descend un peu et s'éteint en ~35 ms,
//  3. un reflet aigu encore plus bref, qui donne le côté "brillant" et précis.
// La hauteur varie un tout petit peu à chaque fois pour que ça ne sonne pas "robotique".

let context: AudioContext | null = null
/** Moment (en ms) du dernier clic, pour ne pas en jouer 50 d'affilée quand ça défile très vite. */
let lastTick = 0
/** Écart minimum entre deux clics (ms). */
const MIN_GAP_MS = 28

/** Joue une note courte qui s'éteint vite. */
function blip(ctx: AudioContext, output: AudioNode, t: number, from: number, to: number, level: number, length: number): void {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + length)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(level, t + 0.002) // attaque instantanée
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length) // extinction rapide
  osc.connect(gain).connect(output)
  osc.start(t)
  osc.stop(t + length + 0.01)
}

/** Joue un clic. `volume` va de 0 (muet) à 1 (fort). */
export function playTick(volume: number): void {
  if (volume <= 0) return
  const now = performance.now()
  if (now - lastTick < MIN_GAP_MS) return
  lastTick = now

  context ??= new AudioContext()
  const ctx = context
  const t = ctx.currentTime
  const variation = 0.97 + Math.random() * 0.06 // ±3 % de hauteur

  // Volume général (courbe "au carré" : plus naturel pour l'oreille)
  const master = ctx.createGain()
  master.gain.value = volume * volume * 0.6
  master.connect(ctx.destination)

  // 1. Le "tac" : bruit blanc de 6 ms, filtré pour ne garder que le claquement
  const length = Math.floor(ctx.sampleRate * 0.006)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2
  const noise = ctx.createBufferSource()
  noise.buffer = buffer
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 4200
  band.Q.value = 1.2
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.9
  noise.connect(band).connect(noiseGain).connect(master)
  noise.start(t)

  // 2. Le "corps" : une note claire, légèrement descendante
  blip(ctx, master, t, 2100 * variation, 1650 * variation, 0.4, 0.035)

  // 3. Le reflet aigu, très bref
  blip(ctx, master, t, 4200 * variation, 3900 * variation, 0.15, 0.015)
}
