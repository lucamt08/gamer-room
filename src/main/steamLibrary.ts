// Liste les jeux de la bibliothèque Steam (installés ou non), pour les ajouter en un clic.
//
// Où Steam range ses infos :
//  - le dossier de Steam est noté dans le registre Windows (HKCU\Software\Valve\Steam → SteamPath) ;
//  - steamapps\libraryfolders.vdf liste toutes les bibliothèques (ex. C:\Program Files (x86)\Steam, D:\SteamLibrary) ;
//  - chaque jeu installé a un fichier steamapps\appmanifest_<numéro>.acf avec son nom et son dossier.
// Les fichiers .vdf/.acf sont du texte au format "clé" "valeur", on lit juste ce qu'il faut.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type { SteamGameEntry } from '@shared/types'
import { libraryAppIds, readAppInfo } from './steamAppInfo'
import { readSteamPlaytimes } from './steamPlaytime'

/** Programmes Steam qui ne sont pas des jeux (outils, redistribuables, Proton...). */
const NOT_GAMES = /redistributable|proton|steam linux runtime|steamvr|dedicated server|\bsdk\b|soundtrack|benchmark/i
const NOT_GAME_IDS = new Set([228980]) // Steamworks Common Redistributables

/** Dossier de Steam déjà trouvé, et quand (voir findSteamFolder). */
let cachedFolder: { folder: string | null; at: number } | null = null
/** Steam pas trouvé : on recherche au plus toutes les 5 minutes (au cas où on l'installe entre-temps). */
const NOT_FOUND_RETRY = 5 * 60_000

/**
 * Dossier d'installation de Steam, ou null si Steam n'est pas installé.
 * Gardé en mémoire : il est demandé toutes les 5 s (suivi des installations), et le lire dans le registre
 * lance reg.exe en BLOQUANT l'appli (règle « processus principal = souris et clavier », voir CLAUDE.md).
 * On le relit seulement si le dossier a disparu (Steam déplacé / désinstallé).
 */
export function findSteamFolder(): string | null {
  if (cachedFolder) {
    const { folder, at } = cachedFolder
    if (folder ? existsSync(folder) : Date.now() - at < NOT_FOUND_RETRY) return folder
  }
  const folder = readSteamFolder()
  cachedFolder = { folder, at: Date.now() }
  return folder
}

/** Lit le dossier de Steam dans le registre (sinon l'emplacement par défaut). */
function readSteamFolder(): string | null {
  try {
    const output = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      encoding: 'utf8',
      windowsHide: true
    })
    const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(output)
    if (match && existsSync(match[1].trim())) return normalize(match[1].trim())
  } catch {
    // clé absente : on essaie l'emplacement par défaut
  }
  const fallback = 'C:\\Program Files (x86)\\Steam'
  return existsSync(fallback) ? fallback : null
}

/** Chemin de steam.exe, ou null. */
export function findSteamExe(): string | null {
  const folder = findSteamFolder()
  const exe = folder ? join(folder, 'steam.exe') : null
  return exe && existsSync(exe) ? exe : null
}

/** Lit la valeur d'une clé "simple" dans un fichier .acf/.vdf : "name"   "Cyberpunk 2077". */
function readValue(text: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s+"([^"]*)"`, 'i').exec(text)
  return match ? match[1].replace(/\\\\/g, '\\') : null
}

/** Toutes les bibliothèques Steam (dossiers qui contiennent un dossier steamapps). */
function libraryFolders(steamFolder: string): string[] {
  const folders = new Set<string>([normalize(steamFolder)])
  try {
    const text = readFileSync(join(steamFolder, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) folders.add(normalize(match[1].replace(/\\\\/g, '\\')))
  } catch {
    // pas de fichier : seulement la bibliothèque principale
  }
  return [...folders]
}

/** Ce qu'on lit dans le fichier appmanifest_<numéro>.acf d'un jeu (présent dès le début du téléchargement). */
export interface SteamManifest {
  appId: number
  name: string
  /** Dossier du jeu, ex. D:\SteamLibrary\steamapps\common\Cyberpunk 2077 */
  installDir: string
  /** Entièrement installé (StateFlags contient 4) ? */
  installed: boolean
  /** Place sur le disque, en octets. */
  sizeOnDisk: number
  /** Téléchargement : octets à télécharger / déjà téléchargés (0 si rien en cours). */
  bytesToDownload: number
  bytesDownloaded: number
}

/** Les fichiers appmanifest de toutes les bibliothèques Steam (numéro du jeu → infos). */
export function readManifests(steamFolder: string): Map<number, SteamManifest> {
  const manifests = new Map<number, SteamManifest>()
  for (const library of libraryFolders(steamFolder)) {
    const steamapps = join(library, 'steamapps')
    let files: string[]
    try {
      files = readdirSync(steamapps).filter((f) => /^appmanifest_\d+\.acf$/i.test(f))
    } catch {
      continue // disque débranché, dossier supprimé...
    }
    for (const file of files) {
      try {
        const text = readFileSync(join(steamapps, file), 'utf8')
        const appId = Number(readValue(text, 'appid'))
        const name = readValue(text, 'name')
        const installDir = readValue(text, 'installdir')
        if (!appId || !name || !installDir) continue
        manifests.set(appId, {
          appId,
          name,
          installDir: join(steamapps, 'common', installDir),
          // StateFlags 4 = "entièrement installé" (sinon : téléchargement en cours, en attente…)
          installed: (Number(readValue(text, 'StateFlags')) & 4) === 4,
          sizeOnDisk: Number(readValue(text, 'SizeOnDisk')) || 0,
          bytesToDownload: Number(readValue(text, 'BytesToDownload')) || 0,
          bytesDownloaded: Number(readValue(text, 'BytesDownloaded')) || 0
        })
      } catch {
        // fichier illisible : on passe au suivant
      }
    }
  }
  return manifests
}

/** Ce n'est pas un jeu (outil, redistribuable, bande-son…) ? */
export function isNotAGame(appId: number, name: string): boolean {
  return NOT_GAME_IDS.has(appId) || NOT_GAMES.test(name)
}

/**
 * Tous les jeux de la bibliothèque Steam, installés ou non, triés par nom.
 *  - installés : lus dans les fichiers appmanifest (taille exacte sur le disque) ;
 *  - non installés : la bibliothèque vue dans le cache de Steam (voir steamAppInfo.ts), plus les jeux déjà
 *    joués (temps de jeu enregistré), avec une taille estimée.
 * `knownAppIds` = numéros déjà dans la bibliothèque de Gamer Room (pour les marquer "déjà ajouté").
 */
export function listSteamGames(knownAppIds: Set<number>): SteamGameEntry[] {
  const steamFolder = findSteamFolder()
  if (!steamFolder) return []

  const playtimes = readSteamPlaytimes() ?? new Map()
  const minutesOf = (appId: number): number => playtimes.get(appId)?.minutes ?? 0
  const games = new Map<number, SteamGameEntry>()

  // 1. Jeux installés
  for (const m of readManifests(steamFolder).values()) {
    if (!m.installed || isNotAGame(m.appId, m.name)) continue
    games.set(m.appId, {
      appId: m.appId,
      name: m.name,
      installDir: m.installDir,
      installed: true,
      sizeBytes: m.sizeOnDisk,
      playtimeMinutes: minutesOf(m.appId),
      alreadyAdded: knownAppIds.has(m.appId)
    })
  }

  // 2. Jeux de la bibliothèque pas installés (ou en cours de téléchargement)
  const appInfo = readAppInfo(steamFolder)
  const played = [...playtimes.entries()].filter(([, p]) => p.minutes > 0).map(([id]) => id)
  for (const appId of new Set([...libraryAppIds(steamFolder), ...played])) {
    if (games.has(appId)) continue
    const info = appInfo.get(appId)
    // Seulement les vrais jeux (pas les démos, outils, DLC, bandes-son…)
    if (!info || info.type !== 'game' || isNotAGame(appId, info.name)) continue
    games.set(appId, {
      appId,
      name: info.name,
      installDir: null,
      installed: false,
      sizeBytes: info.installBytes,
      playtimeMinutes: minutesOf(appId),
      alreadyAdded: knownAppIds.has(appId)
    })
  }
  return [...games.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}
