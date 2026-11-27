// Jeux Battle.net (Blizzard, Activision) installés.
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

/** Entrées de product.db qui ne sont pas des jeux. */
const NOT_GAMES = new Set(['agent', 'battle.net', 'bna'])

/** Ce qu'il faut pour ajouter et lancer un jeu Battle.net. */
export interface BattleNetGame extends DetectedGame {
  uid: string
  /** Battle.net.exe et ses arguments pour lancer le jeu, ou null (on lancera le .exe du jeu). */
  launcher: { exe: string; args: string } | null
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

/** Tous les jeux Battle.net installés (liste vide si Battle.net n'est pas installé). */
export function listBattleNetGames(): BattleNetGame[] {
  const file = join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'Battle.net', 'Agent', 'product.db')
  let installs: { uid: string; code: string; folder: string }[]
  try {
    installs = decode(readFileSync(file))
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
    return [] // Battle.net pas installé, ou fichier illisible
  }

  // Battle.net.exe : dans le dossier de l'entrée "battle.net"
  const client = installs.find((i) => i.uid === 'battle.net')
  const battleNetExe = client ? join(client.folder, 'Battle.net.exe') : null

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
      // Les guillemets gardent "launch WTCG" en un seul argument : --exec=launch WTCG
      launcher: launchCode && battleNetExe && existsSync(battleNetExe) ? { exe: battleNetExe, args: `"--exec=launch ${launchCode}"` } : null
    })
  }
  return games
}
