// Bouton « maison » de la manette : Guide (logo Xbox) ou PS (PlayStation).
//
// On le surveille en permanence, même quand le hub est caché (en jeu) ou fermé (près de l'horloge) :
//  - appui COURT : onShortPress (au moment où on relâche) ;
//  - appui LONG (maintenu LONG_PRESS ms) : onLongPress, dès que la durée est atteinte (sans attendre qu'on relâche).
// La lecture des manettes elle-même est dans windowManager.ts (section 10).

import * as wm from './windowManager'

const POLL_INTERVAL = 50 // ms entre deux lectures des manettes Xbox
const LONG_PRESS = 600 // ms : au-delà, c'est un appui long
const SONY_SCAN_INTERVAL = 3000 // ms : on cherche les nouvelles manettes PlayStation toutes les 3 s

export interface GuideButtonHandlers {
  onShortPress: () => void
  onLongPress: () => void
}

/** Manettes PlayStation ouvertes, par chemin Windows, avec l'état de leur bouton PS. */
const sonyPads = new Map<string, { pad: wm.SonyPad; pressed: boolean }>()
let started = false

/** Démarre la surveillance (une seule fois, au démarrage de l'appli). */
export function startGuideButton(handlers: GuideButtonHandlers): void {
  if (started) return
  started = true

  let pressedSince = 0 // 0 = bouton relâché
  let longFired = false
  let source = '' // d'où vient l'appui (pour le journal) : « Xbox » (XInput) ou « PlayStation » (HID)

  // Toutes les 50 ms : Xbox (lu tout de suite) + PlayStation (dernier état reçu)
  setInterval(() => {
    let xbox = false
    try {
      xbox = wm.isXboxGuidePressed()
    } catch (error) {
      console.warn('[manette] Lecture XInput impossible', error)
    }
    const sony = [...sonyPads.values()].some((entry) => entry.pressed)
    const pressed = xbox || sony

    const now = Date.now()
    if (pressed && pressedSince === 0) {
      pressedSince = now // début de l'appui
      longFired = false
      source = [xbox && 'Xbox', sony && 'PlayStation'].filter(Boolean).join(' + ')
    } else if (pressed && !longFired && now - pressedSince >= LONG_PRESS) {
      longFired = true
      console.log(`[manette] Appui long (${source})`)
      handlers.onLongPress()
    } else if (!pressed && pressedSince !== 0) {
      console.log(`[manette] Bouton relâché après ${now - pressedSince} ms (${source})`)
      if (!longFired) handlers.onShortPress() // relâché avant la durée d'un appui long
      pressedSince = 0
    }
  }, POLL_INTERVAL)

  scanSonyPads()
  setInterval(scanSonyPads, SONY_SCAN_INTERVAL)
}

/** Ouvre les manettes PlayStation nouvellement branchées et commence à les écouter. */
function scanSonyPads(): void {
  let pads: wm.SonyPad[] = []
  try {
    pads = wm.openSonyPads(new Set(sonyPads.keys()))
  } catch (error) {
    console.warn('[manette] Recherche des manettes PlayStation impossible', error)
  }
  for (const pad of pads) {
    console.log(`[manette] Manette PlayStation trouvée (${pad.kind}${pad.bluetooth ? ', Bluetooth' : ', USB'})`)
    const entry = { pad, pressed: false }
    sonyPads.set(pad.path, entry)
    listenSonyPad(entry)
  }
}

/** Lit les rapports d'une manette PlayStation l'un après l'autre, jusqu'à ce qu'elle soit débranchée. */
function listenSonyPad(entry: { pad: wm.SonyPad; pressed: boolean }): void {
  wm.readSonyPsButton(entry.pad, (pressed) => {
    if (pressed === null) {
      console.log('[manette] Manette PlayStation débranchée')
      sonyPads.delete(entry.pad.path)
      wm.closeSonyPad(entry.pad)
      return
    }
    entry.pressed = pressed
    listenSonyPad(entry)
  })
}
