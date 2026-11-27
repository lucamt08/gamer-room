// Images (« textures ») des boîtes de l'étagère 3D, dessinées une fois dans des <canvas> :
// la face avant (jaquette dans son boîtier + badges), la tranche (nom du jeu), l'ombre, la lueur…
// La carte graphique les affiche ensuite sans que le processeur ait à les redessiner.
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'
import type { Game } from '@shared/types'

/** Taille de la face avant en pixels (format jaquette 600x900). */
export const FRONT_W = 600
export const FRONT_H = 900

/** Durée pendant laquelle un jeu est considéré comme "nouveau" : 24 heures, en millisecondes. */
const NEW_GAME_DURATION_MS = 24 * 60 * 60 * 1000

/** Vrai si le jeu a été ajouté à la bibliothèque il y a moins de 24 heures. */
export function isNewGame(addedAt: string): boolean {
  const addedTime = new Date(addedAt).getTime()
  if (Number.isNaN(addedTime)) return false // date invalide ou absente : pas de badge
  return Date.now() - addedTime < NEW_GAME_DURATION_MS
}

/** Couleur stable (teinte 0..360) calculée à partir du nom, pour les boîtes sans jaquette. */
export function hueFromName(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/** Adresse de la jaquette en cache (protocole cover://, voir main/covers.ts). */
export function coverUrl(game: Game): string | null {
  return game.coverFile ? `cover://img/${encodeURIComponent(game.coverFile)}` : null
}

/** Transforme un canvas en texture pour la carte graphique. */
export function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8 // reste net quand la boîte est vue de biais
  return texture
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return [canvas, canvas.getContext('2d')!]
}

/** Dessine une image façon `object-fit: cover` dans le rectangle donné. */
function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / img.width, h / img.height)
  const sw = w / scale
  const sh = h / scale
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h)
}

/** Fond coloré des boîtes sans jaquette (dégradés aux couleurs du jeu) + son nom en bas à gauche. */
function drawGeneric(ctx: CanvasRenderingContext2D, game: Game, x: number, y: number, w: number, h: number, k: number): void {
  const hue = hueFromName(game.name)
  const linear = ctx.createLinearGradient(x, y, x + w * 0.6, y + h)
  linear.addColorStop(0, `hsl(${hue}, 50%, 25%)`)
  linear.addColorStop(1, `hsl(${hue + 40}, 50%, 10%)`)
  ctx.fillStyle = linear
  ctx.fillRect(x, y, w, h)
  const radial = ctx.createRadialGradient(x + w * 0.3, y + h * 0.2, 0, x + w * 0.3, y + h * 0.2, w * 0.75)
  radial.addColorStop(0, `hsla(${hue}, 80%, 60%, 0.5)`)
  radial.addColorStop(1, 'transparent')
  ctx.fillStyle = radial
  ctx.fillRect(x, y, w, h)

  // Nom du jeu, en gras, sur plusieurs lignes si besoin
  const size = 20 * k
  ctx.font = `800 ${size}px 'Segoe UI', system-ui, sans-serif`
  ctx.fillStyle = '#fff'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 8 * k
  ctx.shadowOffsetY = 2 * k
  const maxWidth = w - 32 * k
  const lines: string[] = []
  let line = ''
  for (const word of game.name.split(' ')) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else line = test
  }
  if (line) lines.push(line)
  lines.forEach((text, i) => {
    ctx.fillText(text, x + 16 * k, y + h - 16 * k - (lines.length - 1 - i) * size * 1.15, maxWidth)
  })
  ctx.shadowColor = 'transparent'
}

/** Petit badge arrondi (NOUVEAU, NON INSTALLÉ). */
function drawBadge(ctx: CanvasRenderingContext2D, text: string, k: number, background: string, place: (w: number, h: number) => [number, number]): void {
  ctx.font = `700 ${11 * k}px 'Segoe UI', system-ui, sans-serif`
  ctx.letterSpacing = `${0.55 * k}px`
  const w = ctx.measureText(text).width + 16 * k
  const h = 20 * k
  const [x, y] = place(w, h)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 6 * k
  ctx.shadowOffsetY = 2 * k
  ctx.fillStyle = background
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 4 * k)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 8 * k, y + h / 2 + k * 0.5)
  ctx.textBaseline = 'alphabetic'
  ctx.letterSpacing = '0px'
}

/**
 * Face avant : la jaquette dans un boîtier sombre (bord plus large côté charnière), un reflet fixe
 * sur le plastique, et les badges. `boxWidth` = largeur de la boîte à l'écran (pour garder
 * la même taille de texte qu'avant). `img` = jaquette chargée, ou null (boîte colorée).
 */
export function drawFront(canvas: HTMLCanvasElement, game: Game, img: HTMLImageElement | null, boxWidth: number): void {
  const ctx = canvas.getContext('2d')!
  const W = FRONT_W
  const H = FRONT_H
  const k = W / boxWidth // pixels du canvas pour 1 pixel d'écran
  ctx.clearRect(0, 0, W, H)

  // Boîtier
  const body = ctx.createLinearGradient(0, 0, W, H)
  body.addColorStop(0, '#2a2f3a')
  body.addColorStop(1, '#0b0d12')
  ctx.fillStyle = body
  ctx.fillRect(0, 0, W, H)

  // Jaquette (ou fond coloré), grisée si le jeu n'est pas installé
  const x = 6 * k
  const y = 3 * k
  const w = W - 9 * k
  const h = H - 6 * k
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 2 * k)
  ctx.clip()
  if (game.installed === false) ctx.filter = 'grayscale(0.85) brightness(0.65)'
  if (img) drawCover(ctx, img, x, y, w, h)
  else drawGeneric(ctx, game, x, y, w, h, k)
  ctx.restore()

  // Charnière le long du bord gauche
  const hinge = ctx.createLinearGradient(0, 0, 0, H)
  hinge.addColorStop(0, 'rgba(255, 255, 255, 0.12)')
  hinge.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
  ctx.fillStyle = hinge
  ctx.fillRect(2 * k, 0, 2 * k, H)

  // Reflet fixe sur le plastique (dégradé en biais)
  const angle = (115 * Math.PI) / 180
  const dx = Math.sin(angle)
  const dy = -Math.cos(angle)
  const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2
  const shine = ctx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half)
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.22)')
  shine.addColorStop(0.22, 'rgba(255, 255, 255, 0.05)')
  shine.addColorStop(0.38, 'rgba(255, 255, 255, 0)')
  shine.addColorStop(0.7, 'rgba(255, 255, 255, 0)')
  shine.addColorStop(1, 'rgba(255, 255, 255, 0.07)')
  ctx.fillStyle = shine
  ctx.fillRect(0, 0, W, H)

  // Liseré clair en haut du boîtier
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.fillRect(0, 0, W, Math.max(1, k))

  // Badges
  if (isNewGame(game.addedAt)) drawBadge(ctx, 'NOUVEAU', k, '#ff2d6f', (bw) => [W - bw - 8 * k, 8 * k])
  if (game.installed === false) {
    drawBadge(ctx, 'NON INSTALLÉ', k, 'rgba(0, 0, 0, 0.75)', (bw, bh) => [(W - bw) / 2, H - bh - 10 * k])
  }
}

export function createFrontCanvas(): HTMLCanvasElement {
  return makeCanvas(FRONT_W, FRONT_H)[0]
}

/**
 * Tranche du boîtier avec le nom du jeu écrit à la verticale, et une petite touche de couleur
 * propre au jeu le long du bord. Sert pour les deux tranches (gauche et droite).
 */
export function createSpineTexture(game: Game, boxHeight: number, boxDepth: number): Texture {
  const SW = 64
  const k = SW / boxDepth
  const [canvas, ctx] = makeCanvas(SW, boxHeight * k)
  const H = canvas.height
  const bg = ctx.createLinearGradient(0, 0, SW, 0)
  bg.addColorStop(0, '#07090d')
  bg.addColorStop(0.45, '#1d222c')
  bg.addColorStop(1, '#0e1117')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, SW, H)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.lineWidth = k
  ctx.strokeRect(k / 2, k / 2, SW - k, H - k)
  ctx.fillStyle = `hsla(${hueFromName(game.name)}, 60%, 55%, 0.45)`
  ctx.fillRect(0, 0, 2 * k, H)

  // Nom du jeu, de haut en bas (comme sur la tranche d'un vrai boîtier)
  ctx.save()
  ctx.translate(SW / 2, H / 2)
  ctx.rotate(Math.PI / 2)
  ctx.font = `600 ${10 * k}px 'Segoe UI', system-ui, sans-serif`
  ctx.letterSpacing = `${0.5 * k}px`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const max = H * 0.86
  let text = game.name
  if (ctx.measureText(text).width > max) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > max) text = text.slice(0, -1)
    text = `${text}…`
  }
  ctx.fillText(text, 0, 0)
  ctx.restore()
  return toTexture(canvas)
}

/**
 * Ombre douce d'un rectangle (comme un `box-shadow` CSS), dessinée une fois.
 * `margin` = place autour du rectangle pour le flou. Renvoie la texture.
 */
export function createShadowTexture(
  boxWidth: number,
  boxHeight: number,
  margin: number,
  layers: { offsetY: number; blur: number; color: string; spread?: number }[],
  border?: string
): Texture {
  const s = 256 / (boxWidth + 2 * margin) // réduit : une ombre floue n'a pas besoin de détails
  const [canvas, ctx] = makeCanvas((boxWidth + 2 * margin) * s, (boxHeight + 2 * margin) * s)
  for (const layer of layers) {
    ctx.save()
    // Astuce : on dessine le rectangle hors du canvas et on ne garde que son ombre floue
    ctx.shadowColor = layer.color
    ctx.shadowBlur = layer.blur * s
    ctx.shadowOffsetX = 10000
    ctx.shadowOffsetY = layer.offsetY * s
    const spread = (layer.spread ?? 0) * s
    ctx.fillStyle = '#000'
    ctx.fillRect(margin * s - spread - 10000, margin * s - spread, boxWidth * s + 2 * spread, boxHeight * s + 2 * spread)
    ctx.restore()
  }
  if (border) {
    ctx.strokeStyle = border
    ctx.lineWidth = Math.max(1, 1.5 * s)
    ctx.strokeRect(margin * s, margin * s, boxWidth * s, boxHeight * s)
  }
  return toTexture(canvas)
}

/**
 * Lueur colorée derrière la boîte du centre : une copie très floue et saturée de la jaquette.
 * `margin` = place laissée autour pour que le flou s'étale.
 */
export function createAmbientTexture(game: Game, img: HTMLImageElement | null, width: number, height: number, margin: number): Texture {
  const s = 128 / width
  const [canvas, ctx] = makeCanvas((width + 2 * margin) * s, (height + 2 * margin) * s)
  ctx.filter = `blur(${34 * s}px) saturate(1.7)`
  if (img) {
    drawCover(ctx, img, margin * s, margin * s, width * s, height * s)
  } else {
    ctx.fillStyle = `hsl(${hueFromName(game.name)}, 70%, 45%)`
    ctx.fillRect(margin * s, margin * s, width * s, height * s)
  }
  return toTexture(canvas)
}

/** Dégradé vertical de couleur (dessus / dessous du boîtier). */
export function createGradientTexture(top: string, bottom: string): Texture {
  const [canvas, ctx] = makeCanvas(4, 64)
  const g = ctx.createLinearGradient(0, 0, 0, 64)
  g.addColorStop(0, top)
  g.addColorStop(1, bottom)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 64)
  return toTexture(canvas)
}
