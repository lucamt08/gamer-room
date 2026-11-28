// Priorité du bouton Xbox / PS de la manette pour Gamer Room.
//
// Windows ne laisse pas une appli « réserver » un bouton de manette : Gamer Room, Steam et la Xbox Game Bar
// lisent chacun la manette et réagissent tous au même bouton (3 menus qui s'ouvrent en même temps).
// Ici, quand l'option est activée, on coupe ce bouton chez les AUTRES :
//
//  - Xbox Game Bar : réglage Windows « Autoriser votre manette à ouvrir la Game Bar »
//    = registre de l'utilisateur, HKCU\Software\Microsoft\GameBar, valeur UseNexusForGameBarEnabled (0 = non).
//    ⚠️ Windows ne relit cette valeur qu'à l'ouverture de session (la page Paramètres de Windows, elle, prévient
//    la Game Bar tout de suite). Le réglage reste donc coupé tant que l'option est cochée : il agit dès le
//    prochain démarrage du PC. Il est remis comme avant quand on décoche l'option.
//
//  - Steam (Paramètres › Manette), deux réglages, lignes à la racine de userdata\<compte>\config\localconfig.vdf :
//      "Controller_CheckGuideButton" "0"   = « Le bouton Guide place Steam au premier plan » : non (hors jeu)
//      "SteamController_Enable_Chord" "0"  = « Activer la configuration du bouton guide pour les contrôleurs » : non
//                                            (en jeu : sinon le bouton ouvre l'overlay Steam dans les jeux Steam)
//    ⚠️ Steam garde ses réglages en mémoire et réécrit ce fichier : on ne peut le modifier que quand Steam
//    est FERMÉ. On vérifie donc régulièrement, et on l'écrit dès que Steam est fermé (pour tous les comptes).
//    Ils sont remis comme avant quand on décoche l'option (dès que Steam est fermé).
//
// Les valeurs d'origine sont notées dans userData\controller-priority.json, pour pouvoir les remettre
// même si Gamer Room a planté entre-temps.

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSettings } from './settings'
import { readJson, writeJson } from './jsonStore'
import { findSteamFolder } from './steamLibrary'
import * as wm from './windowManager'

const FILE = 'controller-priority.json'
const GAME_BAR_KEY = 'HKCU\\Software\\Microsoft\\GameBar'
const GAME_BAR_VALUE = 'UseNexusForGameBarEnabled'
/** Réglages Steam mis à "0" (voir en haut du fichier). */
const STEAM_SETTINGS = ['Controller_CheckGuideButton', 'SteamController_Enable_Chord']
/** On regarde si Steam est fermé toutes les 15 s (seulement tant qu'il reste un réglage Steam à écrire). */
const STEAM_CHECK_INTERVAL = 15_000

/** Valeur d'origine d'un réglage. `null` = la ligne n'existait pas (= réglage par défaut : activé). */
type Original = string | null

/** Valeurs d'origine mises de côté. */
interface Saved {
  gameBar?: { value: number | null }
  /** Fichier localconfig.vdf → réglage Steam → valeur d'origine. */
  steam?: Record<string, Record<string, Original>>
}

const OPTIONS = { encoding: 'utf8' as const, windowsHide: true }
let steamTimer: NodeJS.Timeout | null = null

/** Lit nos notes. (Anciennes notes : un seul réglage Steam par fichier, noté directement.) */
function readSaved(): Saved {
  const saved = readJson<Saved>(FILE, {})
  for (const [file, value] of Object.entries(saved.steam ?? {})) {
    if (value === null || typeof value !== 'object') saved.steam![file] = { [STEAM_SETTINGS[0]]: value as Original }
  }
  return saved
}

// ---------------------------------------------------------------------------
//  Xbox Game Bar (registre)
// ---------------------------------------------------------------------------

/** Lit un nombre (REG_DWORD) dans le registre. `null` si la valeur n'existe pas. */
function readDword(key: string, name: string): number | null {
  try {
    const output = execFileSync('reg', ['query', key, '/v', name], { ...OPTIONS, stdio: ['ignore', 'pipe', 'ignore'] })
    const match = /REG_DWORD\s+(0x[0-9a-f]+)/i.exec(output)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

/** Écrit (ou supprime si `value` est null) un nombre dans le registre de l'utilisateur, sans attendre. */
function writeDword(key: string, name: string, value: number | null): void {
  const args =
    value === null
      ? ['delete', key, '/v', name, '/f']
      : ['add', key, '/v', name, '/t', 'REG_DWORD', '/d', String(value), '/f']
  execFile('reg', args, OPTIONS, () => undefined) // erreur = valeur déjà absente : rien à faire
}

// ---------------------------------------------------------------------------
//  Steam (localconfig.vdf, seulement quand Steam est fermé)
// ---------------------------------------------------------------------------

/** Les fichiers localconfig.vdf de tous les comptes Steam du PC. */
function steamConfigFiles(): string[] {
  const steamFolder = findSteamFolder()
  if (!steamFolder) return []
  const userdata = join(steamFolder, 'userdata')
  try {
    return readdirSync(userdata)
      .map((account) => join(userdata, account, 'config', 'localconfig.vdf'))
      .filter((file) => existsSync(file))
  } catch {
    return []
  }
}

function isSteamRunning(): boolean {
  for (const process of wm.snapshotProcesses().values()) {
    if (process.exeName.toLowerCase() === 'steam.exe') return true
  }
  return false
}

/** La ligne d'un réglage, à la racine du fichier (une seule tabulation devant). */
function settingLine(setting: string): RegExp {
  return new RegExp(`^\\t"${setting}"\\t\\t"([^"]*)"\\r?\\n`, 'm')
}

/** Valeur d'un réglage dans le texte du fichier, ou null s'il n'y est pas (= réglage par défaut). */
function readSetting(text: string, setting: string): Original {
  return settingLine(setting).exec(text)?.[1] ?? null
}

/** Écrit (ou retire si `value` est null) un réglage à la racine du texte du fichier. null = fichier inattendu. */
function withSetting(text: string, setting: string, value: Original): string | null {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const line = settingLine(setting)
  if (line.test(text)) return text.replace(line, value === null ? '' : `\t"${setting}"\t\t"${value}"${newline}`)
  if (value === null) return text // déjà absent
  // Pas encore de ligne : on l'ajoute juste avant la dernière accolade (fin du bloc principal)
  const end = text.lastIndexOf('}')
  if (end < 0) return null
  return `${text.slice(0, end)}\t"${setting}"\t\t"${value}"${newline}${text.slice(end)}`
}

/** Applique plusieurs réglages à un fichier. Renvoie false en cas d'échec (le fichier n'est alors pas touché). */
function writeSettings(file: string, values: Record<string, Original>): boolean {
  try {
    const text = readFileSync(file, 'utf8')
    let next: string | null = text
    for (const [setting, value] of Object.entries(values)) {
      next = next === null ? null : withSetting(next, setting, value)
    }
    if (next === null) return false // fichier inattendu : on n'y touche pas
    if (next !== text) writeFileSync(file, next, 'utf8')
    return true
  } catch (error) {
    console.warn('[manette] Réglages Steam impossibles à écrire', file, error)
    return false
  }
}

/** Tous les réglages Steam de ce fichier sont-ils déjà notés (= déjà coupés par nous) ? */
function steamDone(saved: Saved, file: string): boolean {
  const notes = saved.steam?.[file]
  return !!notes && STEAM_SETTINGS.every((setting) => setting in notes)
}

/**
 * Met les réglages Steam dans l'état voulu, si Steam est fermé.
 * Renvoie true quand il n'y a plus rien à faire (sinon on réessaiera plus tard).
 */
function syncSteam(): boolean {
  const files = steamConfigFiles()
  if (files.length === 0) return true // pas de Steam sur ce PC
  const saved = readSaved()
  const want = wanted()

  // Déjà dans le bon état ? (on ne regarde que nos notes : pas besoin de Steam fermé pour ça)
  const done = want ? files.every((file) => steamDone(saved, file)) : !saved.steam
  if (done) return true
  if (isSteamRunning()) return false // on réessaiera quand Steam sera fermé

  if (want) {
    saved.steam ??= {}
    for (const file of files) {
      const notes = saved.steam[file] ?? {}
      const text = readFileSync(file, 'utf8')
      // On ne note que les réglages pas encore coupés (sinon on noterait notre propre "0")
      const missing = STEAM_SETTINGS.filter((setting) => !(setting in notes))
      const originals = Object.fromEntries(missing.map((setting) => [setting, readSetting(text, setting)]))
      if (writeSettings(file, Object.fromEntries(missing.map((setting) => [setting, '0'])))) {
        saved.steam[file] = { ...notes, ...originals }
      }
    }
  } else if (saved.steam) {
    for (const [file, originals] of Object.entries(saved.steam)) {
      if (!existsSync(file) || writeSettings(file, originals)) delete saved.steam[file]
    }
    if (Object.keys(saved.steam).length === 0) delete saved.steam
  }
  writeJson(FILE, saved)
  console.log(`[manette] Réglages Steam du bouton Guide ${want ? 'coupés' : 'remis comme avant'}`)
  return true
}

/** Réessaie toutes les 15 s tant que Steam est ouvert, puis s'arrête. */
function watchSteam(): void {
  if (syncSteam() || steamTimer) return
  steamTimer = setInterval(() => {
    if (syncSteam() && steamTimer) {
      clearInterval(steamTimer)
      steamTimer = null
    }
  }, STEAM_CHECK_INTERVAL)
}

// ---------------------------------------------------------------------------
//  Pour le reste de l'appli
// ---------------------------------------------------------------------------

/** L'option est-elle active ? (il faut aussi que Gamer Room utilise le bouton) */
function wanted(): boolean {
  const settings = getSettings()
  return settings.guideButton && settings.guideButtonPriority
}

/**
 * Applique l'option : coupe le bouton chez la Game Bar et Steam si elle est activée,
 * sinon remet les réglages d'origine. À appeler au démarrage et quand l'option change dans les Paramètres.
 */
export function applyControllerPriority(): void {
  const saved = readSaved()
  if (wanted()) {
    // On note la valeur d'origine une seule fois (sinon on noterait notre propre 0)
    if (!saved.gameBar) {
      saved.gameBar = { value: readDword(GAME_BAR_KEY, GAME_BAR_VALUE) }
      writeJson(FILE, saved)
    }
    writeDword(GAME_BAR_KEY, GAME_BAR_VALUE, 0)
  } else if (saved.gameBar) {
    writeDword(GAME_BAR_KEY, GAME_BAR_VALUE, saved.gameBar.value)
    delete saved.gameBar
    writeJson(FILE, saved)
  }
  watchSteam()
}
