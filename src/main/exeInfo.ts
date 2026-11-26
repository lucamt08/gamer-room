// Lit la "carte d'identité" d'un .exe : nom du produit, description et éditeur.
// C'est ce que Windows affiche dans clic droit → Propriétés → Détails.
// Exemple : D:\jeux\The Last of Us - Part I\launcher.exe
//   → { productName: "The Last of Us™ Part I", publisher: "Sony Interactive Entertainment" }
//
// On lit le fichier nous-mêmes (format "PE" des programmes Windows), sans appeler Windows :
// pas de koffi ici, et ce fichier ne dépend ni d'Electron ni du réseau.
// En cas de problème (fichier illisible, pas de carte d'identité...), on renvoie simplement des null.

import { closeSync, openSync, readSync } from 'node:fs'

export interface ExeInfo {
  /** Nom du produit, ex. "The Last of Us™ Part I". */
  productName: string | null
  /** Description du fichier (souvent le nom du jeu aussi). */
  fileDescription: string | null
  /** Éditeur, ex. "Sony Interactive Entertainment". */
  publisher: string | null
}

const EMPTY: ExeInfo = { productName: null, fileDescription: null, publisher: null }

/** Taille maximum de la zone "ressources" qu'on accepte de lire (icônes comprises). */
const MAX_RESOURCE_SIZE = 64 * 1024 * 1024

/** Numéro des ressources "informations de version" dans un .exe (RT_VERSION). */
const RT_VERSION = 16

/** Lit `length` octets du fichier à partir de `position`. */
function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length)
  const read = readSync(fd, buffer, 0, length, position)
  return buffer.subarray(0, read)
}

/** Lit un texte UTF-16 terminé par un caractère nul, entre `start` et `end`. */
function readText(buf: Buffer, start: number, end: number): { text: string; next: number } {
  let pos = start
  while (pos + 1 < end && buf.readUInt16LE(pos) !== 0) pos += 2
  return { text: buf.toString('utf16le', start, pos), next: pos + 2 }
}

/** Arrondit au multiple de 4 suivant (les blocs sont alignés sur 4 octets). */
function align4(value: number, base: number): number {
  return base + Math.ceil((value - base) / 4) * 4
}

/**
 * Parcourt la structure VS_VERSIONINFO : des blocs imbriqués { clé, valeur, enfants }.
 * On récupère les textes du type "ProductName" → "The Last of Us™ Part I".
 */
function readVersionStrings(buf: Buffer, base: number, start: number, end: number, out: Map<string, string>, depth = 0): void {
  let pos = start
  while (pos + 6 <= end && depth < 6) {
    const length = buf.readUInt16LE(pos)
    if (length < 6) return // bloc invalide : on arrête pour ne pas boucler
    const blockEnd = Math.min(pos + length, end)
    const valueLength = buf.readUInt16LE(pos + 2)
    const isText = buf.readUInt16LE(pos + 4) === 1
    const key = readText(buf, pos + 6, blockEnd)
    const valueStart = align4(key.next, base)

    if (isText && valueLength > 0 && depth >= 2) {
      // Un texte (ex. "CompanyName") : la valeur est elle aussi un texte UTF-16
      const value = readText(buf, valueStart, blockEnd).text.trim()
      if (value && !out.has(key.text)) out.set(key.text, value)
    } else {
      // Un bloc qui contient d'autres blocs (VS_VERSION_INFO, StringFileInfo, table de langue...)
      const valueBytes = isText ? valueLength * 2 : valueLength
      readVersionStrings(buf, base, align4(valueStart + valueBytes, base), blockEnd, out, depth + 1)
    }
    pos = align4(pos + length, base)
  }
}

/** Lit la carte d'identité d'un .exe. Ne lance jamais d'erreur. */
export function readExeInfo(exePath: string): ExeInfo {
  let fd: number | null = null
  try {
    fd = openSync(exePath, 'r')

    // 1. En-têtes du programme : on cherche où se trouvent les "ressources"
    const header = readAt(fd, 0, 4096)
    if (header.length < 64 || header.toString('latin1', 0, 2) !== 'MZ') return EMPTY
    const pe = header.readUInt32LE(0x3c)
    if (pe + 24 > header.length || header.toString('latin1', pe, pe + 4) !== 'PE\0\0') return EMPTY
    const sectionCount = header.readUInt16LE(pe + 6)
    const optionalSize = header.readUInt16LE(pe + 20)
    const optional = pe + 24
    const is64 = header.readUInt16LE(optional) === 0x20b
    const directories = optional + (is64 ? 112 : 96)
    const resourceRva = header.readUInt32LE(directories + 2 * 8) // 3e entrée = ressources
    if (!resourceRva) return EMPTY

    // 2. La "section" du fichier qui contient les ressources
    let section: { rva: number; offset: number; size: number } | null = null
    for (let i = 0; i < sectionCount; i++) {
      const s = optional + optionalSize + i * 40
      if (s + 40 > header.length) break
      const rva = header.readUInt32LE(s + 12)
      const size = Math.max(header.readUInt32LE(s + 8), header.readUInt32LE(s + 16))
      if (resourceRva >= rva && resourceRva < rva + size) {
        section = { rva, offset: header.readUInt32LE(s + 20), size: header.readUInt32LE(s + 16) }
        break
      }
    }
    if (!section || section.size > MAX_RESOURCE_SIZE) return EMPTY
    const res = readAt(fd, section.offset, section.size)
    const root = resourceRva - section.rva

    // 3. Dans les ressources : type → nom → langue. On suit RT_VERSION puis la première entrée.
    const findEntry = (dir: number, id: number | null): number | null => {
      if (dir + 16 > res.length) return null
      const count = res.readUInt16LE(dir + 12) + res.readUInt16LE(dir + 14)
      for (let i = 0; i < count; i++) {
        const entry = dir + 16 + i * 8
        if (entry + 8 > res.length) return null
        if (id === null || res.readUInt32LE(entry) === id) return res.readUInt32LE(entry + 4)
      }
      return null
    }
    let target = findEntry(root, RT_VERSION)
    for (let level = 0; level < 2 && target !== null && target & 0x80000000; level++) {
      target = findEntry(root + (target & 0x7fffffff), null)
    }
    if (target === null || target & 0x80000000) return EMPTY

    // 4. Les données de version elles-mêmes
    const dataEntry = root + target
    if (dataEntry + 8 > res.length) return EMPTY
    const dataStart = res.readUInt32LE(dataEntry) - section.rva
    const dataEnd = Math.min(dataStart + res.readUInt32LE(dataEntry + 4), res.length)
    if (dataStart < 0 || dataStart >= dataEnd) return EMPTY

    const strings = new Map<string, string>()
    readVersionStrings(res, dataStart, dataStart, dataEnd, strings)
    return {
      productName: strings.get('ProductName') ?? null,
      fileDescription: strings.get('FileDescription') ?? null,
      publisher: strings.get('CompanyName') ?? null
    }
  } catch {
    return EMPTY
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
