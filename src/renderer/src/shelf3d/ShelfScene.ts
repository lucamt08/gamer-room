// L'étagère en 3D, dessinée par la carte graphique (WebGL, avec la bibliothèque three.js).
//
// Avant, chaque boîte était faite de <div> en 3D CSS : le processeur devait recalculer ~500 éléments
// à chaque image, et l'appli ramait sur les grands écrans rapides (174 Hz). Ici, tout est envoyé à la
// carte graphique : le processeur ne fait plus que quelques calculs de position par image.
//
// Le rendu reproduit l'ancien CSS (mêmes tailles, même perspective, mêmes animations) :
//  - le jeu sélectionné au centre, de face et agrandi ; les autres de chaque côté, tournés vers le centre,
//  - la boîte du centre flotte, un éclat de brillance la balaie, elle pivote pour suivre la souris,
//  - une lueur aux couleurs de la jaquette derrière elle, des ombres douces, un reflet sur le sol.
//
// Unités : 1 unité 3D = 1 pixel d'écran (sur le plan de l'écran), comme le CSS d'avant.
// Repère : x vers la droite, y vers le HAUT (inverse du CSS), z vers nous. L'origine est le point de fuite.

import {
  BoxGeometry,
  CustomBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector2,
  Vector3,
  WebGLRenderer,
  ZeroFactor,
  type Material,
  type Texture
} from 'three'
import type { Game } from '@shared/types'
import { cubicBezier, EASE_IN_OUT, EASE_OUT, Tween } from './tween'
import {
  coverUrl,
  createAmbientTexture,
  createFrontCanvas,
  createGradientTexture,
  createShadowTexture,
  createSpineTexture,
  drawFront,
  isNewGame,
  toTexture
} from './textures'

/** Distance de la « caméra » (comme `perspective: 1300px` en CSS). */
const PERSPECTIVE = 1300
/** Agrandissement de la boîte du centre. */
const FOCUS_SCALE = 1.32
/** Au-delà de cette distance du centre, les boîtes ne sont pas dessinées. */
const MAX_VISIBLE_DISTANCE = 16
/** Inclinaison maximale (en degrés) quand la souris est au bord de la boîte du centre. */
const MAX_TILT_LEFT_RIGHT = 24
const MAX_TILT_UP_DOWN = 14
/** Place autour des boîtes pour le flou des ombres (px). */
const SHADOW_MARGIN = 150

const DEG = Math.PI / 180

/**
 * Défilement, en deux étages :
 *  1. un « guide » avance en ligne droite vers le jeu sélectionné, À LA VITESSE où arrivent les crans
 *     (flèche maintenue, manette, molette : on mesure leur rythme). Le réglage « Vitesse de défilement »
 *     change donc vraiment la vitesse à l'écran, et l'étagère ne prend jamais de retard ;
 *  2. un « ressort » suit ce guide en douceur : pas d'à-coup quand on accélère ou ralentit, et un léger
 *     dépassement à l'arrêt (amortissement < 1), qui donne la sensation de « cran ».
 */
const GLIDE_MIN_SPEED = 6 // jeux par seconde, pour un cran isolé
const GLIDE_RATE_MARGIN = 1.08 // le guide va un peu plus vite que les crans : il ne se laisse pas distancer
const STEP_PAUSE_MS = 350 // au-delà, on considère que les crans ne s'enchaînent plus
const SPRING_SPEED = 18 // raideur du ressort (plus grand = suit le guide de plus près)
const SPRING_DAMPING = 0.75 // amortissement (1 = pas de rebond)
/** Pendant un glisser à la souris : ressort plus raide et sans rebond, l'étagère colle au curseur. */
const DRAG_SPRING_SPEED = 32
const DRAG_SPRING_DAMPING = 1

// Courbes d'animation (les mêmes que dans l'ancien CSS)
const SMOOTH = cubicBezier(0.22, 1, 0.36, 1) // agrandissement, survol, apparition
const SNAP = cubicBezier(0.3, 1.6, 0.5, 1) // petit « pop » de la boîte qui arrive au centre
const TILT_BACK = cubicBezier(0.23, 1.3, 0.32, 1) // retour de l'inclinaison quand la souris s'en va

/** Une boîte de l'étagère et tout ce qui l'anime. */
interface Item {
  game: Game
  /** Ce qui change l'apparence (jaquette, installé…) : si ça change, on redessine. */
  signature: string
  img: HTMLImageElement | null
  // Groupes imbriqués, de l'extérieur vers l'intérieur (comme les <div> d'avant) :
  root: Group // place dans le carrousel (décalage, profondeur, rotation)
  wrap: Group // agrandissement depuis le sol + apparition
  float: Group // flottement, soulèvement au survol
  snap: Group // petit « pop » (agrandissement autour du centre de la boîte)
  box: Group // inclinaison qui suit la souris
  mesh: Mesh
  frontCanvas: HTMLCanvasElement
  frontTexture: Texture
  spineTexture: Texture
  frontMaterial: MeshBasicMaterial
  shadow: Mesh // ombre normale
  glow: Mesh // ombre + halo bleu de la boîte du centre
  ambient: Mesh | null // lueur colorée (créée la première fois que la boîte passe au centre)
  // Valeurs animées (la place dans l'étagère, elle, vient de la position du ressort)
  /** Survol à la souris (0 = non, 1 = oui) : la boîte se soulève et s'éclaircit. */
  hover: Tween
  ambientOpacity: Tween
  /** Moment où la boîte est arrivée au centre (pour le pop, le flottement et l'éclat). */
  selectedAt: number
  /** Début de l'animation d'apparition (au lancement de l'appli). */
  enterAt: number
}

export class ShelfScene {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera()
  private shelf = new Group()
  private items: Item[] = []
  private selected = 0
  /** Position actuelle de l'étagère (numéro de jeu, avec virgule pendant le mouvement) et sa vitesse. */
  private position = 0
  private velocity = 0
  /** Le guide que suit le ressort (voir plus haut), et le rythme mesuré des crans (jeux par seconde). */
  private glide = 0
  private stepRate = 0
  private lastStepAt = 0
  /** Glisser à la souris en cours : décalage en fraction de jeu (l'étagère suit le curseur). */
  private dragOffset = 0
  private dragging = false
  private lastFrame = 0
  private hovered = -1
  private hoverEnabled = false
  private pressed = new Tween(1, 100)
  private tiltX = new Tween(0, 800, TILT_BACK)
  private tiltY = new Tween(0, 800, TILT_BACK)
  private glareOpacity = new Tween(0, 400)
  private tilting = false
  private glare = new Vector2(0.3, 0.15)
  private overlay: Mesh<PlaneGeometry, ShaderMaterial>
  private fadeScene = new Scene()
  private fadeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private fade: Mesh<PlaneGeometry, ShaderMaterial>
  private raycaster = new Raycaster()
  private frame = 0
  private firstGames = true
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Tailles (px), recalculées quand la fenêtre change
  private width = 1
  private height = 1
  private boxW = 200
  private boxH = 300
  private boxD = 28
  private stageH = 400
  private floorY = 0
  private boxGeometry = new BoxGeometry(1, 1, 1)
  private frontGeometry = new PlaneGeometry(1, 1)
  private shadowGeometry = new PlaneGeometry(1, 1)
  private shadowTexture: Texture | null = null
  private glowTexture: Texture | null = null
  private topMaterial = new MeshBasicMaterial({ map: createGradientTexture('#2b313c', '#12151b') })
  private bottomMaterial = new MeshBasicMaterial({ map: createGradientTexture('#12151b', '#2b313c') })
  private backMaterial = new MeshBasicMaterial({ color: 0x0b0d12 })

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true, // fond transparent : on voit le dégradé de la page derrière
      powerPreference: 'high-performance'
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.autoClear = false
    this.scene.add(this.shelf)

    // Éclat de brillance + reflet lumineux qui suit la souris, posés sur la jaquette du centre
    this.overlay = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uSize: { value: new Vector2(1, 1) },
          uSheen: { value: 0 },
          uSheenAlpha: { value: 0 },
          uGlare: { value: new Vector2(0.3, 0.15) },
          uGlareAlpha: { value: 0 }
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec2 uSize;
          uniform float uSheen;
          uniform float uSheenAlpha;
          uniform vec2 uGlare;
          uniform float uGlareAlpha;
          varying vec2 vUv;
          void main() {
            // Position en pixels, depuis le coin en haut à gauche (comme en CSS)
            vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
            // Éclat : bande blanche inclinée (105°) qui traverse la jaquette
            vec2 dir = vec2(sin(radians(105.0)), -cos(radians(105.0)));
            float len = abs(2.0 * uSize.x * dir.x) + abs(2.0 * uSize.y * dir.y);
            float t = dot(p - uSize * 0.5 - vec2(uSheen * 2.0 * uSize.x, 0.0), dir) / len + 0.5;
            float sheen = 0.32 * max(0.0, 1.0 - abs(t - 0.5) / 0.08) * uSheenAlpha;
            // Reflet : tache lumineuse ronde autour de la souris
            vec2 g = uGlare * uSize;
            float radius = length(max(g, uSize - g));
            float d = length(p - g) / radius;
            float glare = d < 0.3 ? mix(0.5, 0.08, d / 0.3) : mix(0.08, 0.0, clamp((d - 0.3) / 0.3, 0.0, 1.0));
            gl_FragColor = vec4(1.0, 1.0, 1.0, clamp(sheen + glare * 0.55 * uGlareAlpha, 0.0, 1.0));
          }`
      })
    )
    this.overlay.renderOrder = 10

    // Reflet sur le sol : on dessine l'étagère à l'envers sous le sol, puis ce rectangle
    // l'efface progressivement vers le bas (il multiplie l'image déjà dessinée par un dégradé)
    this.fade = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: ZeroFactor,
        blendDst: SrcAlphaFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: SrcAlphaFactor,
        uniforms: { uFloor: { value: 0 }, uLength: { value: 1 } },
        vertexShader: /* glsl */ `
          void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uFloor;  // hauteur du sol, en pixels depuis le bas du canvas
          uniform float uLength; // hauteur sur laquelle le reflet disparaît
          void main() {
            float below = uFloor - gl_FragCoord.y;
            float a = below < 0.0 ? 0.0 : 0.38 * clamp(1.0 - below / uLength, 0.0, 1.0);
            gl_FragColor = vec4(0.0, 0.0, 0.0, a);
          }`
      })
    )
    this.fade.frustumCulled = false
    this.fadeScene.add(this.fade)

    const loop = (): void => {
      this.frame = requestAnimationFrame(loop)
      this.render(performance.now())
    }
    this.frame = requestAnimationFrame(loop)
  }

  // ---------------------------------------------------------------------------
  // Taille
  // ---------------------------------------------------------------------------

  /** Taille du canvas (px), hauteur de la zone des boîtes et largeur d'une boîte (comme `--box-width`). */
  setSize(width: number, height: number, stageHeight: number, boxWidth: number): void {
    const boxChanged = boxWidth !== this.boxW
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.stageH = stageHeight
    this.boxW = boxWidth
    this.boxH = boxWidth * 1.5
    this.boxD = boxWidth * 0.14
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(this.width, this.height, false)

    // Caméra : même perspective qu'en CSS, avec le point de fuite à 50 % de la largeur
    // et 40 % de la hauteur de la zone des boîtes (`perspective-origin: 50% 40%`)
    const vx = this.width / 2
    const vy = stageHeight * 0.4
    const near = 10
    const far = 6000
    const k = near / PERSPECTIVE
    this.camera.position.set(0, 0, PERSPECTIVE)
    this.camera.projectionMatrix.makePerspective(-vx * k, (this.width - vx) * k, vy * k, (vy - this.height) * k, near, far)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
    this.camera.updateMatrixWorld()
    this.floorY = vy - stageHeight

    // Reflet : il s'efface sur 42 % de la hauteur de la zone des boîtes (comme avant)
    const ratio = this.renderer.getPixelRatio()
    this.fade.material.uniforms.uFloor.value = (this.height - stageHeight - 2) * ratio
    this.fade.material.uniforms.uLength.value = stageHeight * 0.42 * ratio

    if (boxChanged) this.rebuildSizes()
  }

  /** Géométries et textures qui dépendent de la taille des boîtes. */
  private rebuildSizes(): void {
    const { boxW: w, boxH: h, boxD: d } = this
    this.boxGeometry.dispose()
    this.boxGeometry = new BoxGeometry(w, h, d)
    this.frontGeometry.dispose()
    this.frontGeometry = new PlaneGeometry(w, h)
    this.shadowGeometry.dispose()
    this.shadowGeometry = new PlaneGeometry(w + 2 * SHADOW_MARGIN, h + 2 * SHADOW_MARGIN)
    this.shadowTexture?.dispose()
    this.shadowTexture = createShadowTexture(w, h, SHADOW_MARGIN, [{ offsetY: 18, blur: 40, color: 'rgba(0, 0, 0, 0.6)' }])
    this.glowTexture?.dispose()
    this.glowTexture = createShadowTexture(
      w,
      h,
      SHADOW_MARGIN,
      [
        { offsetY: 30, blur: 60, color: 'rgba(0, 0, 0, 0.7)' },
        { offsetY: 0, blur: 50, color: 'rgba(90, 150, 255, 0.35)' }
      ],
      'rgba(150, 190, 255, 0.35)'
    )
    this.overlay.geometry = this.frontGeometry
    this.overlay.material.uniforms.uSize.value.set(w, h)
    this.overlay.position.z = d + 0.4

    for (const item of this.items) {
      item.mesh.geometry = this.boxGeometry
      item.shadow.geometry = this.shadowGeometry
      item.glow.geometry = this.shadowGeometry
      ;(item.shadow.material as MeshBasicMaterial).map = this.shadowTexture
      ;(item.glow.material as MeshBasicMaterial).map = this.glowTexture
      item.mesh.position.z = d / 2
      item.shadow.position.z = d - 0.4
      item.glow.position.z = d - 0.3
      item.spineTexture.dispose()
      item.spineTexture = createSpineTexture(item.game, h, d)
      const materials = item.mesh.material as MeshBasicMaterial[]
      materials[0].map = item.spineTexture
      materials[1].map = item.spineTexture
      materials[0].needsUpdate = materials[1].needsUpdate = true
      this.redrawFront(item)
      this.refreshAmbient(item)
    }
  }

  // ---------------------------------------------------------------------------
  // Jeux et sélection
  // ---------------------------------------------------------------------------

  setGames(games: Game[]): void {
    const now = performance.now()
    const old = new Map(this.items.map((item) => [item.game.id, item]))
    const next: Item[] = []
    games.forEach((game, index) => {
      let item = old.get(game.id)
      if (item) {
        old.delete(game.id)
        const signature = signatureOf(game)
        const coverChanged = item.game.coverFile !== game.coverFile
        item.game = game
        if (signature !== item.signature) {
          item.signature = signature
          if (coverChanged) this.loadCover(item)
          else this.redrawFront(item)
          this.refreshAmbient(item)
        }
      } else {
        item = this.createItem(game, index, now)
      }
      next.push(item)
    })
    for (const item of old.values()) this.disposeItem(item) // jeux retirés
    this.items = next
    if (this.firstGames) {
      // Premier affichage : l'étagère est directement à la bonne place (sans défiler depuis le début)
      this.position = this.glide = this.selected
      this.velocity = 0
      this.prepareAmbients()
      // Prépare tout de suite les programmes de la carte graphique (sinon : à-coup au 1er défilement)
      this.renderer.compile(this.scene, this.camera)
    }
    this.firstGames = false
    this.onSelectionChanged(now)
  }

  setSelected(index: number): void {
    if (index === this.selected) return
    const now = performance.now()
    // Rythme des crans : nombre de jeux passés depuis le cran précédent, divisé par le temps écoulé
    const gap = now - this.lastStepAt
    if (gap < STEP_PAUSE_MS && gap > 0) {
      const rate = (Math.abs(index - this.selected) * 1000) / gap
      this.stepRate = this.stepRate ? this.stepRate * 0.3 + rate * 0.7 : rate // moyenne qui lisse les irrégularités
    } else this.stepRate = 0
    this.lastStepAt = now
    this.selected = index
    // Les boîtes bougent sous la souris immobile : pas d'effet de survol tant qu'elle ne bouge pas
    this.setHovered(-1, now)
    this.hoverEnabled = false
    if (this.reducedMotion) this.position = this.glide = index
    this.onSelectionChanged(now)
  }

  /**
   * Glisser à la souris en cours : décalage (en fraction de jeu) entre le curseur et le dernier cran.
   * L'étagère suit le curseur au lieu d'avancer seulement à chaque cran. 0 et `false` à la fin du glisser.
   */
  setDrag(offset: number, dragging: boolean): void {
    this.dragOffset = dragging ? offset : 0
    this.dragging = dragging
  }

  /** Le jeu du centre a changé : pop, flottement, lueur, éclat (la position, elle, suit le ressort). */
  private onSelectionChanged(now: number): void {
    this.items.forEach((item, index) => {
      const selected = index === this.selected
      item.ambientOpacity.set(selected ? 0.6 : 0, now)
      if (selected && item.selectedAt < 0) {
        item.selectedAt = now
        if (!item.ambient) this.createAmbient(item)
      }
      if (!selected) item.selectedAt = -1
    })
    // L'éclat et le reflet de la souris suivent la boîte du centre
    const current = this.items[this.selected]
    if (current) current.box.add(this.overlay)
    else this.overlay.removeFromParent()
    this.tilting = false
    this.tiltX.set(0, now)
    this.tiltY.set(0, now)
    this.glareOpacity.jump(0)
    this.glareOpacity.set(0.45, now)
  }

  /**
   * Lueurs colorées préparées à l'avance, une par une quand l'appli n'a rien à faire :
   * sinon chaque jeu qui passe au centre pour la première fois la fabrique pendant le défilement (petit à-coup).
   */
  private prepareAmbients(): void {
    const next = (): void => {
      const item = this.items.find((candidate) => !candidate.ambient && candidate.img)
      if (!item) return
      this.createAmbient(item)
      requestIdleCallback(next)
    }
    // On attend un peu que les jaquettes soient chargées
    setTimeout(() => requestIdleCallback(next), 1500)
  }

  // ---------------------------------------------------------------------------
  // Souris
  // ---------------------------------------------------------------------------

  /** Numéro du jeu sous la souris (coordonnées de la fenêtre), ou -1. */
  hitTest(clientX: number, clientY: number): number {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const pointer = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(pointer, this.camera)
    const meshes = this.items.filter((item) => item.root.visible).map((item) => item.mesh)
    const hit = this.raycaster.intersectObjects(meshes, false)[0]
    return hit ? this.items.findIndex((item) => item.mesh === hit.object) : -1
  }

  /** La souris bouge sur l'étagère : survol des boîtes de côté, inclinaison de celle du centre. */
  pointerMove(clientX: number, clientY: number, dragging: boolean): number {
    const now = performance.now()
    this.hoverEnabled = !dragging
    const hit = dragging ? -1 : this.hitTest(clientX, clientY)
    this.setHovered(hit !== this.selected ? hit : -1, now)

    // Inclinaison : position de la souris dans le rectangle de la boîte du centre (0..1)
    const rect = this.selectedRect()
    const inside =
      !dragging && rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    if (inside && rect) {
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      this.tilting = true
      this.tiltY.set((0.5 - x) * 2 * MAX_TILT_LEFT_RIGHT * DEG, now, 120, EASE_OUT)
      this.tiltX.set((y - 0.5) * 2 * MAX_TILT_UP_DOWN * DEG, now, 120, EASE_OUT)
      this.glare.set(x, y)
      this.glareOpacity.set(1, now)
    } else this.stopTilt(now)
    return hit
  }

  pointerLeave(): void {
    const now = performance.now()
    this.setHovered(-1, now)
    this.stopTilt(now)
    this.pressed.set(1, now)
  }

  /** Bouton de la souris enfoncé / relâché sur la boîte du centre (elle s'enfonce un peu). */
  setPressed(down: boolean, clientX = 0, clientY = 0): void {
    const now = performance.now()
    this.pressed.set(down && this.hitTest(clientX, clientY) === this.selected ? 0.97 : 1, now)
  }

  private setHovered(index: number, now: number): void {
    const next = this.hoverEnabled ? index : -1
    if (next === this.hovered) return
    this.items[this.hovered]?.hover.set(0, now)
    this.hovered = next
    this.items[next]?.hover.set(1, now) // la boîte survolée se soulève un peu et s'éclaircit
  }

  private stopTilt(now: number): void {
    if (!this.tilting) return
    this.tilting = false
    this.tiltX.set(0, now, 800, TILT_BACK)
    this.tiltY.set(0, now, 800, TILT_BACK)
    this.glareOpacity.set(0.45, now)
  }

  /** Rectangle à l'écran de la boîte du centre (sans son inclinaison), comme `getBoundingClientRect`. */
  private selectedRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number } | null {
    const item = this.items[this.selected]
    if (!item) return null
    item.snap.updateWorldMatrix(true, false)
    const canvasRect = this.renderer.domElement.getBoundingClientRect()
    const xs: number[] = []
    const ys: number[] = []
    for (const [cx, cy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1]
    ]) {
      const p = new Vector3((cx * this.boxW) / 2, (cy * this.boxH) / 2, 0).applyMatrix4(item.snap.matrixWorld)
      p.project(this.camera)
      xs.push(canvasRect.left + ((p.x + 1) / 2) * canvasRect.width)
      ys.push(canvasRect.top + ((1 - p.y) / 2) * canvasRect.height)
    }
    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    return { left, right, top, bottom, width: right - left, height: bottom - top }
  }

  // ---------------------------------------------------------------------------
  // Création des boîtes
  // ---------------------------------------------------------------------------

  private createItem(game: Game, index: number, now: number): Item {
    const frontCanvas = createFrontCanvas()
    const frontTexture = toTexture(frontCanvas)
    const spineTexture = createSpineTexture(game, this.boxH, this.boxD)
    const frontMaterial = new MeshBasicMaterial({ map: frontTexture })
    const spineMaterial = new MeshBasicMaterial({ map: spineTexture })
    // Ordre des faces d'une boîte three.js : droite, gauche, dessus, dessous, avant, arrière
    const mesh = new Mesh(this.boxGeometry, [
      spineMaterial,
      spineMaterial.clone(),
      this.topMaterial,
      this.bottomMaterial,
      frontMaterial,
      this.backMaterial
    ])
    const shadowMaterial = (map: Texture | null): MeshBasicMaterial =>
      new MeshBasicMaterial({ map, transparent: true, depthWrite: false })
    const shadow = new Mesh(this.shadowGeometry, shadowMaterial(this.shadowTexture))
    const glow = new Mesh(this.shadowGeometry, shadowMaterial(this.glowTexture))
    // Comme en CSS : la boîte va du plan de la charnière (z = 0) jusqu'à la face avant (z = épaisseur)
    mesh.position.z = this.boxD / 2
    shadow.position.z = this.boxD - 0.4
    glow.position.z = this.boxD - 0.3

    const root = new Group()
    const wrap = new Group()
    const float = new Group()
    const snap = new Group()
    const box = new Group()
    box.rotation.order = 'XYZ'
    root.add(wrap)
    wrap.add(float)
    float.add(snap)
    snap.add(box)
    box.add(mesh, shadow, glow)
    this.shelf.add(root)

    const dist = Math.abs(index - this.selected)
    const item: Item = {
      game,
      signature: signatureOf(game),
      img: null,
      root,
      wrap,
      float,
      snap,
      box,
      mesh,
      frontCanvas,
      frontTexture,
      spineTexture,
      frontMaterial,
      shadow,
      glow,
      ambient: null,
      hover: new Tween(0, 400, SMOOTH),
      ambientOpacity: new Tween(0, 800),
      selectedAt: -1,
      // Apparition en cascade au lancement de l'appli (pas pour un jeu ajouté ensuite)
      enterAt: this.firstGames && !this.reducedMotion ? now + dist * 45 : -Infinity
    }
    this.redrawFront(item)
    this.loadCover(item)
    return item
  }

  /** Charge la jaquette (si le jeu en a une), puis redessine la face avant. */
  private loadCover(item: Item): void {
    const url = coverUrl(item.game)
    item.img = null
    this.redrawFront(item)
    if (!url) return
    const img = new Image()
    img.crossOrigin = 'anonymous' // nécessaire pour en faire une texture (voir main/covers.ts)
    img.onload = () => {
      if (coverUrl(item.game) !== url) return // la jaquette a changé entre-temps
      item.img = img
      this.redrawFront(item)
      this.refreshAmbient(item)
    }
    img.src = url
  }

  private redrawFront(item: Item): void {
    drawFront(item.frontCanvas, item.game, item.img, this.boxW)
    item.frontTexture.needsUpdate = true
    // Envoyée tout de suite à la carte graphique : sinon elle le serait au moment où la boîte
    // apparaît à l'écran, en plein défilement (petit à-coup)
    this.renderer.initTexture(item.frontTexture)
  }

  /** Lueur colorée derrière la boîte (une copie floue de la jaquette), comme `.box-ambient`. */
  private createAmbient(item: Item): void {
    const w = this.boxW * 0.92
    const h = this.boxH * 0.92
    const margin = 110
    const texture = createAmbientTexture(item.game, item.img, w, h, margin)
    const ambient = new Mesh(
      new PlaneGeometry(w + 2 * margin, h + 2 * margin),
      new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 })
    )
    // Placée un peu derrière la boîte, légèrement plus grande, alignée sur le bas
    ambient.position.set(0, -this.boxH * 0.04, -60)
    ambient.scale.setScalar(1.05)
    item.snap.add(ambient)
    item.ambient = ambient
  }

  /** Refait la lueur (nouvelle jaquette, nouvelle taille) si la boîte est au centre. */
  private refreshAmbient(item: Item): void {
    this.disposeAmbient(item)
    if (item.selectedAt >= 0) this.createAmbient(item)
  }

  private disposeAmbient(item: Item): void {
    if (!item.ambient) return
    item.ambient.removeFromParent()
    item.ambient.geometry.dispose()
    const material = item.ambient.material as MeshBasicMaterial
    material.map?.dispose()
    material.dispose()
    item.ambient = null
  }

  private disposeItem(item: Item): void {
    item.root.removeFromParent()
    if (this.overlay.parent === item.box) this.overlay.removeFromParent()
    this.disposeAmbient(item)
    item.frontTexture.dispose()
    item.spineTexture.dispose()
    const materials = item.mesh.material as Material[]
    materials[0].dispose()
    materials[1].dispose()
    materials[4].dispose()
    ;(item.shadow.material as Material).dispose()
    ;(item.glow.material as Material).dispose()
  }

  // ---------------------------------------------------------------------------
  // Dessin (à chaque image)
  // ---------------------------------------------------------------------------

  /** Fait avancer le ressort du défilement de `dt` secondes. */
  private stepSpring(dt: number, now: number): void {
    // (au bout de l'étagère, le glisser ne dépasse que d'un tiers de jeu)
    const last = Math.max(0, this.items.length - 1)
    const goal = Math.max(-0.33, Math.min(last + 0.33, this.selected + this.dragOffset))
    if (now - this.lastStepAt > STEP_PAUSE_MS) this.stepRate = 0 // les crans se sont arrêtés

    // 1. Le guide avance en ligne droite vers le jeu sélectionné (pendant un glisser : il colle au curseur)
    if (this.dragging) this.glide = goal
    else {
      const remaining = goal - this.glide
      // Crans qui s'enchaînent : on avance à leur rythme (un peu plus vite, pour ne pas se laisser distancer).
      // Cran isolé : vitesse fixe, plus rapide si on est loin (clic sur une boîte éloignée, molette rapide).
      const glideSpeed =
        this.stepRate > 0
          ? Math.max(this.stepRate * GLIDE_RATE_MARGIN, Math.abs(remaining) * 3)
          : Math.max(GLIDE_MIN_SPEED, Math.abs(remaining) * 5)
      const move = glideSpeed * Math.min(dt, 0.1)
      this.glide = Math.abs(remaining) <= move ? goal : this.glide + Math.sign(remaining) * move
    }

    // 2. Le ressort suit le guide (plus raide quand ça défile vite, pour ne pas traîner derrière)
    const target = this.glide
    const speed = this.dragging ? DRAG_SPRING_SPEED : Math.max(SPRING_SPEED, this.stepRate * 4)
    // Pas de petit rebond tant que les crans s'enchaînent (sinon ça « pompe » à chaque cran)
    const damping = this.dragging || this.stepRate > 0 ? DRAG_SPRING_DAMPING : SPRING_DAMPING
    // Petits pas de calcul (2 ms max) : le ressort reste stable même si une image arrive en retard
    let left = Math.min(dt, 0.1)
    while (left > 0) {
      const step = Math.min(left, 0.002)
      const force = -speed * speed * (this.position - target) - 2 * damping * speed * this.velocity
      this.velocity += force * step
      this.position += this.velocity * step
      left -= step
    }
    // Arrivé (à un millième de jeu près) : on s'arrête net
    if (Math.abs(this.position - target) < 0.001 && Math.abs(this.velocity) < 0.01) {
      this.position = target
      this.velocity = 0
    }
  }

  private render(now: number): void {
    const dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0
    this.lastFrame = now
    this.stepSpring(dt, now)

    const h = this.boxH
    const w = this.boxW
    this.items.forEach((item, index) => {
      // Écart (avec virgule) entre cette boîte et la position de l'étagère : 0 = au centre
      const offset = index - this.position
      const dist = Math.abs(offset)
      item.root.visible = dist <= MAX_VISIBLE_DISTANCE + 1
      if (!item.root.visible) return
      const selected = item.selectedAt >= 0
      // Entre le centre et la 1re place de côté (|écart| < 1), on passe en douceur de l'un à l'autre
      const side = Math.max(-1, Math.min(1, offset))
      const centered = Math.max(0, 1 - dist) // 1 = pile au centre, 0 = sur le côté
      const hover = item.hover.value(now)

      // Place dans le carrousel (mêmes formules que l'ancien CSS, mais avec un écart continu)
      const x = dist <= 1 ? offset * w * 1.3 : Math.sign(offset) * (w * 1.3 + (dist - 1) * w * 0.34)
      item.root.position.set(x, h / 2, Math.min(dist, 1) * -170 - dist * 4)
      item.root.rotation.y = side * -40 * DEG

      // Agrandissement depuis le sol (+ légère pression au clic sur la boîte du centre)
      const pressed = selected ? this.pressed.value(now) : 1
      item.wrap.position.y = -h / 2
      item.wrap.scale.setScalar((1 + (FOCUS_SCALE - 1) * centered) * pressed)
      // Apparition au lancement : la boîte monte de 60 px en se redressant
      const enter = item.enterAt === -Infinity ? 1 : SMOOTH(Math.max(0, (now - item.enterAt) / 900))
      if (enter >= 1) item.enterAt = -Infinity
      item.wrap.position.y += -60 * (1 - enter)
      item.wrap.rotation.x = 12 * DEG * (1 - enter)

      // Flottement de la boîte du centre (monte de 6 px et redescend, toutes les 5 s), ou survol
      let floatY = 12 * hover
      let snapScale = 1
      if (selected && !this.reducedMotion) {
        const since = now - item.selectedAt
        if (since < 400) snapScale = 0.93 + 0.07 * SNAP(since / 400)
        else {
          const f = ((since - 400) % 5000) / 5000
          floatY = f < 0.5 ? 6 * EASE_IN_OUT(f / 0.5) : 6 * (1 - EASE_IN_OUT((f - 0.5) / 0.5))
        }
      }
      item.float.position.y = floatY
      item.snap.position.y = h / 2
      item.snap.scale.setScalar(snapScale)

      // Inclinaison qui suit la souris (boîte du centre)
      item.box.rotation.x = selected ? -this.tiltX.value(now) : 0
      // (légère rotation de la boîte du centre pour laisser voir la tranche)
      item.box.rotation.y = 7 * DEG * centered + (selected ? this.tiltY.value(now) : 0)

      // Voile sombre : plus une boîte est loin du centre, plus elle est sombre (sauf survolée)
      const shade = dist < 1 ? 0.155 * dist : Math.min(dist * 0.035 + 0.12, 0.6)
      const light = 1 - (shade + (0.02 - shade) * hover * (1 - centered))
      item.frontMaterial.color.setScalar(Math.pow(light, 2.2)) // voile noir comme en CSS (couleurs « linéaires »)
      const glow = centered
      ;(item.glow.material as MeshBasicMaterial).opacity = glow
      ;(item.shadow.material as MeshBasicMaterial).opacity = 1 - glow
      item.glow.visible = glow > 0.001
      if (item.ambient) {
        const opacity = item.ambientOpacity.value(now)
        ;(item.ambient.material as MeshBasicMaterial).opacity = opacity
        item.ambient.visible = opacity > 0.001
      }
    })

    // Éclat de brillance : passe sur la jaquette du centre toutes les 4,5 s
    const uniforms = this.overlay.material.uniforms
    const current = this.items[this.selected]
    uniforms.uSheenAlpha.value = 0
    if (current && current.selectedAt >= 0 && !this.reducedMotion) {
      const since = now - current.selectedAt - 600
      if (since > 0) {
        const f = (since % 4500) / 4500
        if (f < 0.35) {
          uniforms.uSheen.value = -0.7 + 1.4 * EASE_IN_OUT(f / 0.35)
          uniforms.uSheenAlpha.value = 1
        }
      }
    }
    uniforms.uGlare.value.copy(this.glare)
    uniforms.uGlareAlpha.value = this.glareOpacity.value(now)

    // 1. Le reflet : l'étagère à l'envers, 2 px sous le sol, puis effacée vers le bas
    this.renderer.clear()
    this.shelf.position.y = this.floorY - 2
    this.shelf.scale.y = -1
    this.renderer.render(this.scene, this.camera)
    this.renderer.render(this.fadeScene, this.fadeCamera)
    // 2. L'étagère elle-même, par-dessus
    this.renderer.clearDepth()
    this.shelf.position.y = this.floorY
    this.shelf.scale.y = 1
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    for (const item of this.items) this.disposeItem(item)
    this.items = []
    this.boxGeometry.dispose()
    this.frontGeometry.dispose()
    this.shadowGeometry.dispose()
    this.shadowTexture?.dispose()
    this.glowTexture?.dispose()
    this.topMaterial.map?.dispose()
    this.bottomMaterial.map?.dispose()
    this.overlay.material.dispose()
    this.fade.geometry.dispose()
    this.fade.material.dispose()
    this.renderer.dispose()
  }
}

/** Ce qui change l'apparence d'une boîte : si ça change, on la redessine. */
function signatureOf(game: Game): string {
  return [game.name, game.coverFile ?? '', game.installed === false ? 'off' : 'on', isNewGame(game.addedAt) ? 'new' : ''].join('|')
}

