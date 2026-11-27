// Lit le cache de Steam pour connaître TOUS les jeux de la bibliothèque, même non installés.
//
// Deux fichiers de Steam, mis à jour par Steam lui-même :
//  - appcache\librarycache\<numéro du jeu>\ : un dossier d'images par jeu de la bibliothèque
//    (c'est notre liste des jeux possédés, sans clé ni Internet) ;
//  - appcache\appinfo.vdf : infos sur chaque app (nom, type jeu/démo/outil/DLC, tailles des fichiers).
//    C'est un fichier BINAIRE (format "VDF binaire" de Valve), lu ici octet par octet.
//
// Format de appinfo.vdf (versions 28 et 29) :
//   en-tête : magic (4 octets) + univers (4) [+ v29 : position de la table des textes (8)]
//   puis pour chaque app : numéro (4, 0 = fin), taille (4), 60 octets d'infos, puis les données en VDF binaire.
//   VDF binaire : un octet de type, une clé, une valeur. Types : 0 = bloc { }, 1 = texte, 2 = entier 32 bits,
//   3 = décimal, 7 et 10 = entier 64 bits, 8 = fin du bloc. En v29, les clés sont des numéros dans une table de textes.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAGIC_V28 = 0x07564428
const MAGIC_V29 = 0x07564429

/** Ce qu'on garde d'une app Steam. */
export interface SteamAppInfo {
  appId: number
  name: string
  /** "game", "demo", "tool", "dlc", "music", "application"… (en minuscules). */
  type: string
  /** Place estimée une fois installé, en octets (0 si inconnue). */
  installBytes: number
}

type Kv = { [key: string]: string | number | Kv }

/** Lecteur de VDF binaire sur un buffer. */
class VdfReader {
  pos = 0
  constructor(
    private buf: Buffer,
    private strings: string[] | null
  ) {}

  private cString(): string {
    const end = this.buf.indexOf(0, this.pos)
    const text = this.buf.toString('utf8', this.pos, end)
    this.pos = end + 1
    return text
  }

  private key(): string {
    if (!this.strings) return this.cString()
    const index = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return this.strings[index] ?? ''
  }

  /** Lit un bloc jusqu'à son octet de fin (8). */
  block(): Kv {
    const result: Kv = {}
    for (;;) {
      const type = this.buf[this.pos++]
      if (type === 0x08 || type === undefined) return result
      const key = this.key()
      switch (type) {
        case 0x00:
          result[key] = this.block()
          break
        case 0x01:
          result[key] = this.cString()
          break
        case 0x02:
          result[key] = this.buf.readInt32LE(this.pos)
          this.pos += 4
          break
        case 0x03:
          result[key] = this.buf.readFloatLE(this.pos)
          this.pos += 4
          break
        case 0x07:
        case 0x0a:
          result[key] = Number(this.buf.readBigUInt64LE(this.pos))
          this.pos += 8
          break
        default:
          throw new Error(`Type VDF inconnu (${type})`)
      }
    }
  }
}

/** Sous-bloc d'un bloc VDF, ou null. */
function sub(kv: Kv | null | undefined, key: string): Kv | null {
  const value = kv?.[key]
  return value && typeof value === 'object' ? value : null
}

/**
 * Taille estimée d'un jeu installé : somme des "dépôts" (paquets de fichiers) qu'on installerait
 * sur Windows, dans la langue de base. Sans les versions 32 bits si une version 64 bits existe,
 * sans les versions "censurées" et sans les dépôts des DLC. C'est une estimation (≈).
 */
function estimateInstallBytes(app: Kv): number {
  const depots = sub(app, 'depots')
  if (!depots) return 0
  const list = Object.entries(depots)
    .filter(([id, depot]) => /^\d+$/.test(id) && typeof depot === 'object')
    .map(([, depot]) => depot as Kv)
  const has64 = list.some((d) => sub(d, 'config')?.['osarch'] === '64')
  let total = 0
  for (const depot of list) {
    const config = sub(depot, 'config')
    const os = config?.['oslist']
    if (typeof os === 'string' && os && !os.includes('windows')) continue
    const language = config?.['language']
    if (typeof language === 'string' && language && language !== 'english') continue
    if (has64 && config?.['osarch'] === '32') continue
    if (config?.['lowviolence'] === '1' || depot['dlcappid'] !== undefined) continue
    const size = sub(sub(depot, 'manifests'), 'public')?.['size'] ?? depot['maxsize']
    if (size !== undefined && Number.isFinite(Number(size))) total += Number(size)
  }
  return total
}

/** Lit appinfo.vdf en entier (environ 1 Mo, quelques millisecondes). */
function parseAppInfo(file: string): Map<number, SteamAppInfo> {
  const buf = readFileSync(file)
  const magic = buf.readUInt32LE(0)
  if (magic !== MAGIC_V28 && magic !== MAGIC_V29) throw new Error(`Format de appinfo.vdf inconnu (${magic.toString(16)})`)

  // v29 : table des textes à la fin du fichier
  let strings: string[] | null = null
  let pos = 8
  if (magic === MAGIC_V29) {
    let p = Number(buf.readBigUInt64LE(8))
    pos = 16
    const count = buf.readUInt32LE(p)
    p += 4
    strings = []
    for (let i = 0; i < count; i++) {
      const end = buf.indexOf(0, p)
      strings.push(buf.toString('utf8', p, end))
      p = end + 1
    }
  }

  const apps = new Map<number, SteamAppInfo>()
  for (;;) {
    const appId = buf.readUInt32LE(pos)
    if (appId === 0) break
    const size = buf.readUInt32LE(pos + 4)
    const next = pos + 8 + size
    try {
      const reader = new VdfReader(buf, strings)
      reader.pos = pos + 8 + 60 // on saute les 60 octets d'infos (dates, empreintes…)
      const root = reader.block()
      const app = sub(root, 'appinfo') ?? root
      const common = sub(app, 'common')
      const name = common?.['name']
      if (typeof name === 'string' && name) {
        apps.set(appId, {
          appId,
          name,
          type: String(common?.['type'] ?? '').toLowerCase(),
          installBytes: estimateInstallBytes(app)
        })
      }
    } catch {
      // une app illisible n'empêche pas de lire les autres
    }
    pos = next
  }
  return apps
}

let cache: { file: string; modifiedAt: number; apps: Map<number, SteamAppInfo> } | null = null

/** Infos de toutes les apps connues de Steam (relu seulement si le fichier a changé). */
export function readAppInfo(steamFolder: string): Map<number, SteamAppInfo> {
  const file = join(steamFolder, 'appcache', 'appinfo.vdf')
  try {
    const modifiedAt = statSync(file).mtimeMs
    if (cache && cache.file === file && cache.modifiedAt === modifiedAt) return cache.apps
    const apps = parseAppInfo(file)
    cache = { file, modifiedAt, apps }
    return apps
  } catch (error) {
    console.warn('[steam] Impossible de lire appinfo.vdf', error)
    return cache?.apps ?? new Map()
  }
}

/** Numéros des jeux de la bibliothèque Steam : un dossier d'images par jeu dans librarycache. */
export function libraryAppIds(steamFolder: string): Set<number> {
  try {
    return new Set(
      readdirSync(join(steamFolder, 'appcache', 'librarycache'))
        .filter((name) => /^\d+$/.test(name))
        .map(Number)
    )
  } catch {
    return new Set()
  }
}
