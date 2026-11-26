// Lit le temps de jeu enregistré par Steam, pour l'afficher dans Gamer Room.
//
// Où Steam range ces infos :
//  - chaque compte Steam utilisé sur le PC a un dossier Steam\userdata\<numéro du compte> ;
//  - dedans, config\localconfig.vdf contient, pour chaque jeu joué :
//      UserLocalConfigStore > Software > Valve > Steam > apps > "<numéro du jeu>" > "Playtime" (en minutes)
//    et "LastPlayed" (date de la dernière partie, en secondes depuis 1970) ;
//  - le compte connecté en ce moment est noté dans le registre :
//      HKCU\Software\Valve\Steam\ActiveProcess → ActiveUser (0 si personne n'est connecté).
// Steam met ce fichier à jour lui-même, que le jeu soit lancé depuis Steam ou depuis Gamer Room.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findSteamFolder } from './steamLibrary'

/** Ce que Steam sait d'un jeu. */
export interface SteamPlaytime {
  /** Temps de jeu total, en minutes. */
  minutes: number
  /** Dernière partie (date), ou null. */
  lastPlayed: Date | null
}

/** On recherche le bon compte Steam au plus toutes les 5 minutes (ça lance une commande Windows). */
const ACCOUNT_CHECK_INTERVAL = 5 * 60_000

let configFile: string | null = null
let configFileCheckedAt = 0
/** Dernière lecture du fichier (pour ne le relire que s'il a changé). */
let lastRead: { file: string; modifiedAt: number; data: Map<number, SteamPlaytime> } | null = null

/** Numéro du compte Steam connecté (registre Windows), ou null. */
function activeAccountId(): string | null {
  try {
    const output = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'], {
      encoding: 'utf8',
      windowsHide: true
    })
    const match = /ActiveUser\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(output)
    const id = match ? parseInt(match[1], 16) : 0
    return id > 0 ? String(id) : null
  } catch {
    return null
  }
}

/**
 * Trouve le fichier localconfig.vdf du bon compte :
 *  1. celui du compte connecté à Steam en ce moment ;
 *  2. sinon, celui modifié le plus récemment (= le dernier compte utilisé).
 */
function findConfigFile(): string | null {
  const steamFolder = findSteamFolder()
  if (!steamFolder) return null
  const userdata = join(steamFolder, 'userdata')
  const fileOf = (account: string): string => join(userdata, account, 'config', 'localconfig.vdf')

  const active = activeAccountId()
  if (active && existsSync(fileOf(active))) return fileOf(active)

  let best: { file: string; time: number } | null = null
  try {
    for (const account of readdirSync(userdata)) {
      const file = fileOf(account)
      if (!existsSync(file)) continue
      const time = statSync(file).mtimeMs
      if (!best || time > best.time) best = { file, time }
    }
  } catch {
    // pas de dossier userdata : Steam n'a jamais été utilisé
  }
  return best?.file ?? null
}

// ----------------------------------------------------------------------------
//  Lecture du format .vdf de Steam : du texte "clé" "valeur" ou "clé" { ... }
// ----------------------------------------------------------------------------

/** Un bloc { ... } du fichier : clé (en minuscules) → texte ou sous-bloc. */
type VdfNode = { [key: string]: string | VdfNode }

/** Transforme le texte d'un fichier .vdf en objets imbriqués. */
function parseVdf(text: string): VdfNode {
  const root: VdfNode = {}
  const stack: VdfNode[] = [root]
  let pendingKey: string | null = null
  // Un "mot" est soit un texte entre guillemets, soit une accolade
  const tokens = /"((?:[^"\\]|\\.)*)"|([{}])/g
  let match: RegExpExecArray | null
  while ((match = tokens.exec(text)) !== null) {
    const current = stack[stack.length - 1]
    if (match[2] === '{') {
      const child: VdfNode = {}
      if (pendingKey !== null) current[pendingKey] = child
      stack.push(child)
      pendingKey = null
    } else if (match[2] === '}') {
      if (stack.length > 1) stack.pop()
      pendingKey = null
    } else if (pendingKey === null) {
      pendingKey = match[1].toLowerCase() // Steam écrit parfois "Apps", parfois "apps"
    } else {
      current[pendingKey] = match[1]
      pendingKey = null
    }
  }
  return root
}

/** Suit un chemin de clés dans le fichier, ex. ['software', 'valve', 'steam', 'apps']. */
function dig(node: VdfNode, path: string[]): VdfNode | null {
  let current: VdfNode | string | undefined = node
  for (const key of path) {
    if (!current || typeof current === 'string') return null
    current = current[key]
  }
  return current && typeof current !== 'string' ? current : null
}

/**
 * Temps de jeu de chaque jeu Steam (numéro du jeu → minutes + dernière partie).
 * Renvoie null si Steam n'est pas installé ou si le fichier est illisible.
 * Le fichier n'est relu que s'il a été modifié depuis la dernière fois (on peut appeler souvent).
 */
export function readSteamPlaytimes(): Map<number, SteamPlaytime> | null {
  if (Date.now() - configFileCheckedAt > ACCOUNT_CHECK_INTERVAL) {
    configFile = findConfigFile()
    configFileCheckedAt = Date.now()
  }
  if (!configFile) return null

  try {
    const modifiedAt = statSync(configFile).mtimeMs
    if (lastRead && lastRead.file === configFile && lastRead.modifiedAt === modifiedAt) return lastRead.data

    const root = parseVdf(readFileSync(configFile, 'utf8'))
    const apps = dig(root, ['userlocalconfigstore', 'software', 'valve', 'steam', 'apps'])
    if (!apps) return null

    const data = new Map<number, SteamPlaytime>()
    for (const [appId, info] of Object.entries(apps)) {
      if (typeof info === 'string' || !/^\d+$/.test(appId)) continue
      const minutes = Number(info['playtime'])
      const lastPlayed = Number(info['lastplayed'])
      data.set(Number(appId), {
        minutes: Number.isFinite(minutes) ? minutes : 0,
        lastPlayed: lastPlayed > 0 ? new Date(lastPlayed * 1000) : null
      })
    }
    lastRead = { file: configFile, modifiedAt, data }
    return data
  } catch (error) {
    console.warn('[steam] Impossible de lire le temps de jeu de Steam', error)
    return null
  }
}
