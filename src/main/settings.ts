// Paramètres de l'application, stockés dans userData/settings.json.
// ⚠️ La clé API SteamGridDB est stockée ICI, sur le PC de chacun.
//    Elle n'est jamais écrite dans le dossier du projet, donc jamais commitée.

import type { Settings } from '@shared/types'
import { DEFAULT_SCROLL_SETTINGS } from '@shared/scroll'
import { readJson, writeJson } from './jsonStore'

const FILE = 'settings.json'

export const DEFAULT_SETTINGS: Settings = {
  steamGridDbApiKey: '',
  killShortcut: 'Ctrl+Alt+F4',
  startFullscreen: false,
  trackOutsideApp: true, // compter le temps de jeu même hors de Gamer Room (démarre avec Windows)
  fwsPath: '', // dossier de Flawless Widescreen : '' = recherche automatique
  gameFolders: [], // dossiers de jeux choisis à la main (en plus des dossiers habituels comme D:\Games)
  guideButton: true, // bouton Guide / PS : ouvrir Gamer Room, appui long en jeu = menu sur le côté
  ...DEFAULT_SCROLL_SETTINGS // molette, glisser, manette (voir shared/scroll.ts)
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (!cache) {
    cache = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(FILE, {}) }
  }
  return cache
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  writeJson(FILE, cache)
  return cache
}
