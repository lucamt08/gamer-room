// Paramètres de l'application, stockés dans userData/settings.json.
// ⚠️ La clé API SteamGridDB est stockée ICI, sur le PC de chacun.
//    Elle n'est jamais écrite dans le dossier du projet, donc jamais commitée.

import type { Settings } from '@shared/types'
import { readJson, writeJson } from './jsonStore'

const FILE = 'settings.json'

export const DEFAULT_SETTINGS: Settings = {
  steamGridDbApiKey: '',
  killShortcut: 'Ctrl+Alt+F4',
  startFullscreen: false
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
