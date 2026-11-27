// Jeux Battle.net (Blizzard, Activision) : installés, et pas installés mais téléchargeables (voir CATALOG).
//
// Battle.net note ses jeux installés dans C:\ProgramData\Battle.net\Agent\product.db.
// C'est un fichier BINAIRE au format "protobuf" (format de Google). Ce qui nous intéresse :
//   champ 1 (répété) = un jeu installé :
//      champ 1 = uid (ex. "hs_beta"), champ 2 = code produit (ex. "hsb"),
//      champ 3 = réglages → champ 1 = dossier d'installation (ex. "D:/Hearthstone").
// Les entrées "agent" et "battle.net" sont Battle.net lui-même (pas des jeux).
//
// Lancement : Battle.net.exe --exec="launch <code>" lance directement le jeu par Battle.net.
// Le code de lancement n'est pas toujours le code produit (Hearthstone : "hsb" → "WTCG") :
// on utilise la liste ci-dessous, et pour un jeu inconnu de cette liste, on lance son .exe directement.
//
// Installation : le lien battlenet://<code de lancement> (ex. battlenet://Pro) ouvre Battle.net sur la page
// du jeu, avec son bouton « Installer ». Le suivi installé / non installé est dans battleNetInstalls.ts.

import { existsSync, readFileSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { findMainExe } from './mainExe'
import { readExeInfo } from '../exeInfo'
import { fallbackNames } from '../gameNames'

/** Code produit (dans product.db) → code à donner à Battle.net.exe --exec="launch …". */
const LAUNCH_CODES: Record<string, string> = {
  hsb: 'WTCG', // Hearthstone
  pro: 'Pro', // Overwatch
  wow: 'WoW', // World of Warcraft
  d3: 'D3', // Diablo III
  fenris: 'Fen', // Diablo IV
  osi: 'OSI', // Diablo II: Resurrected
  anbs: 'ANBS', // Diablo Immortal
  hero: 'Hero', // Heroes of the Storm
  s1: 'S1', // StarCraft Remastered
  s2: 'S2', // StarCraft II
  w3: 'W3', // Warcraft III: Reforged
  gryphon: 'GRY', // Warcraft Rumble
  odin: 'ODIN', // Call of Duty: Modern Warfare (2019)
  viper: 'VIPR', // Call of Duty: Black Ops 4
  zeus: 'ZEUS', // Call of Duty: Black Ops Cold War
  fore: 'FORE', // Call of Duty: Vanguard
  auks: 'AUKS', // Call of Duty (HQ)
  lazr: 'LAZR', // Call of Duty: Modern Warfare II
  wlby: 'WLBY', // Crash Bandicoot 4
  rtro: 'RTRO' // Blizzard Arcade Collection
}

/**
 * Jeux proposés même s'ils ne sont pas installés (bouton « Installer ») :
 *  - les jeux GRATUITS de Battle.net (tout compte peut les télécharger) ;
 *  - et les jeux déjà installés un jour sur ce PC (Battle.net s'en souvient dans Battle.net.config).
 * Battle.net ne garde pas la liste des jeux achetés sur le PC : un jeu payant jamais installé ici n'est pas proposé.
 * uid = identifiant dans product.db et Battle.net.config, code = code produit (clé de LAUNCH_CODES).
 */
const CATALOG: { uid: string; code: string; name: string; free: boolean }[] = [
  { uid: 'prometheus', code: 'pro', name: 'Overwatch 2', free: true },
  { uid: 'hs_beta', code: 'hsb', name: 'Hearthstone', free: true },
  { uid: 'heroes', code: 'hero', name: 'Heroes of the Storm', free: true },
  { uid: 's2', code: 's2', name: 'StarCraft II', free: true },
  { uid: 's1', code: 's1', name: 'StarCraft', free: true },
  { uid: 'anbs', code: 'anbs', name: 'Diablo Immortal', free: true },
  { uid: 'gryphon', code: 'gryphon', name: 'Warcraft Rumble', free: true },
  { uid: 'auks', code: 'auks', name: 'Call of Duty', free: true }, // Warzone est gratuit
  { uid: 'wow', code: 'wow', name: 'World of Warcraft', free: true }, // essai gratuit
  { uid: 'diablo3', code: 'd3', name: 'Diablo III', free: false },
  { uid: 'fenris', code: 'fenris', name: 'Diablo IV', free: false },
  { uid: 'osi', code: 'osi', name: 'Diablo II: Resurrected', free: false },
  { uid: 'w3', code: 'w3', name: 'Warcraft III: Reforged', free: false }
]

/** Entrées de product.db qui ne sont pas des jeux. */
const NOT_GAMES = new Set(['agent', 'battle.net', 'bna'])

/** Ce qu'il faut pour ajouter et lancer un jeu Battle.net. */
export interface BattleNetGame extends DetectedGame {
  uid: string
  /** Code produit, ex. "hsb" (Hearthstone). */
  productCode: string
  /** Battle.net.exe et ses arguments pour lancer le jeu, ou null (on lancera le .exe du jeu). */
  launcher: { exe: string; args: string } | null
}

/** Commande Battle.net qui lance un jeu (les guillemets gardent "launch WTCG" en un seul argument). */
function launchCommand(battleNetExe: string, launchCode: string): { exe: string; args: string } {
  return { exe: battleNetExe, args: `"--exec=launch ${launchCode}"` }
}

/**
 * Lien qui ouvre Battle.net sur la page d'un jeu (avec son bouton « Installer »), ex. battlenet://Pro.
 * `uid` = identifiant du jeu (storeId dans Gamer Room). null si on ne connaît pas son code.
 */
export function battleNetInstallUrl(uid: string): string | null {
  const code = CATALOG.find((c) => c.uid === uid)?.code
  const launchCode = code ? LAUNCH_CODES[code] : undefined
  return launchCode ? `battlenet://${launchCode}` : null
}

// ----------------------------------------------------------------------------
//  Lecture minimale du format protobuf
// ----------------------------------------------------------------------------

/** Un champ protobuf : son numéro et sa valeur (octets pour les textes / sous-messages, nombre sinon). */
type Field = { field: number; bytes?: Buffer; value?: number }

/** Lit un nombre "varint" (1 à 10 octets, 7 bits par octet). */
function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0
  let multiplier = 1
  for (;;) {
    const byte = buf[pos++]
    if (byte === undefined) throw new Error('fin de fichier inattendue')
    result += (byte & 0x7f) * multiplier
    if (!(byte & 0x80)) return [result, pos]
    multiplier *= 128
  }
}

/** Découpe un message protobuf en champs. */
function decode(buf: Buffer): Field[] {
  const fields: Field[] = []
  let pos = 0
  while (pos < buf.length) {
    let key: number
    ;[key, pos] = readVarint(buf, pos)
    const field = Math.floor(key / 8)
    const wire = key % 8
    if (wire === 0) {
      let value: number
      ;[value, pos] = readVarint(buf, pos)
      fields.push({ field, value })
    } else if (wire === 2) {
      let length: number
      ;[length, pos] = readVarint(buf, pos)
      fields.push({ field, bytes: buf.subarray(pos, pos + length) })
      pos += length
    } else if (wire === 1) pos += 8
    else if (wire === 5) pos += 4
    else throw new Error(`type protobuf inconnu (${wire})`)
  }
  return fields
}

/** Texte d'un champ, ou ''. */
function text(fields: Field[], number: number): string {
  return fields.find((f) => f.field === number)?.bytes?.toString('utf8') ?? ''
}

// ----------------------------------------------------------------------------

/** Les entrées de product.db (jeux installés + Battle.net lui-même), ou null si Battle.net n'est pas installé. */
function readInstalls(): { uid: string; code: string; folder: string }[] | null {
  const file = join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'Battle.net', 'Agent', 'product.db')
  try {
    return decode(readFileSync(file))
      .filter((f) => f.field === 1 && f.bytes)
      .map((f) => {
        const install = decode(f.bytes!)
        const settings = install.find((s) => s.field === 3)?.bytes
        return {
          uid: text(install, 1),
          code: text(install, 2).toLowerCase(),
          folder: settings ? normalize(text(decode(settings), 1)) : ''
        }
      })
  } catch {
    return null // Battle.net pas installé, ou fichier illisible
  }
}

/** Battle.net.exe (dans le dossier de l'entrée "battle.net" de product.db), ou null. */
function findBattleNetExe(installs: { uid: string; folder: string }[]): string | null {
  const client = installs.find((i) => i.uid === 'battle.net')
  const exe = client ? join(client.folder, 'Battle.net.exe') : null
  return exe && existsSync(exe) ? exe : null
}

/** Tous les jeux Battle.net installés (liste vide si Battle.net n'est pas installé). */
export function listBattleNetGames(): BattleNetGame[] {
  const installs = readInstalls()
  if (!installs) return []
  const battleNetExe = findBattleNetExe(installs)

  const games: BattleNetGame[] = []
  for (const install of installs) {
    if (NOT_GAMES.has(install.uid) || NOT_GAMES.has(install.code) || !install.folder || !existsSync(install.folder)) continue
    const exePath = findMainExe(install.folder)
    if (!exePath) continue
    const launchCode = LAUNCH_CODES[install.code]
    games.push({
      key: `battlenet:${install.uid}`,
      source: 'battlenet',
      // Nom : carte d'identité du .exe ("Hearthstone"), sinon le nom du dossier
      name: fallbackNames(exePath, readExeInfo(exePath))[0] ?? basename(install.folder),
      folder: install.folder,
      exePath,
      sizeBytes: null,
      confidence: 'high',
      reasons: ['Battle.net'],
      uid: install.uid,
      productCode: install.code,
      launcher: launchCode && battleNetExe ? launchCommand(battleNetExe, launchCode) : null
    })
  }
  return games
}

/** uid des jeux déjà installés un jour sur ce PC (section "Games" de %APPDATA%\Battle.net\Battle.net.config). */
function previouslyInstalled(): Set<string> {
  try {
    const file = join(process.env['APPDATA'] ?? '', 'Battle.net', 'Battle.net.config')
    const config = JSON.parse(readFileSync(file, 'utf8')) as { Games?: Record<string, unknown> }
    return new Set(Object.keys(config.Games ?? {}))
  } catch {
    return new Set()
  }
}

/**
 * Jeux Battle.net PAS installés qu'on peut télécharger : les jeux gratuits, et ceux déjà installés un jour
 * sur ce PC (donc sur le compte). `installed` = les jeux installés (on ne les propose pas deux fois).
 */
export function listBattleNetNotInstalled(installed: BattleNetGame[]): BattleNetGame[] {
  const installs = readInstalls()
  const battleNetExe = installs ? findBattleNetExe(installs) : null
  if (!battleNetExe) return [] // pas de Battle.net : impossible d'installer
  const known = previouslyInstalled()
  return CATALOG.filter(
    (c) =>
      (c.free || known.has(c.uid)) &&
      LAUNCH_CODES[c.code] &&
      !installed.some((g) => g.uid === c.uid || g.productCode === c.code)
  ).map((c) => ({
    key: `battlenet:${c.uid}`,
    source: 'battlenet' as const,
    name: c.name,
    folder: '',
    exePath: '',
    sizeBytes: null,
    confidence: 'high' as const,
    reasons: ['Battle.net'],
    installed: false,
    uid: c.uid,
    productCode: c.code,
    launcher: launchCommand(battleNetExe, LAUNCH_CODES[c.code])
  }))
}
