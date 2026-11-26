// Liste les jeux Steam installés sur le PC, pour les ajouter en un clic.
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

/** Programmes Steam qui ne sont pas des jeux (outils, redistribuables, Proton...). */
const NOT_GAMES = /redistributable|proton|steam linux runtime|steamvr|dedicated server|\bsdk\b|soundtrack|benchmark/i
const NOT_GAME_IDS = new Set([228980]) // Steamworks Common Redistributables

/** Dossier d'installation de Steam, ou null si Steam n'est pas installé. */
export function findSteamFolder(): string | null {
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

/**
 * Liste les jeux Steam complètement installés, triés par nom.
 * `knownAppIds` = numéros déjà dans la bibliothèque (pour les marquer "déjà ajouté").
 */
export function listSteamGames(knownAppIds: Set<number>): SteamGameEntry[] {
  const steamFolder = findSteamFolder()
  if (!steamFolder) return []

  const games = new Map<number, SteamGameEntry>()
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
        // StateFlags 4 = "entièrement installé" (on ignore les jeux en cours de téléchargement)
        const installed = (Number(readValue(text, 'StateFlags')) & 4) === 4
        if (!appId || !name || !installDir || !installed) continue
        if (NOT_GAME_IDS.has(appId) || NOT_GAMES.test(name)) continue
        games.set(appId, {
          appId,
          name,
          installDir: join(steamapps, 'common', installDir),
          alreadyAdded: knownAppIds.has(appId)
        })
      } catch {
        // fichier illisible : on passe au suivant
      }
    }
  }
  return [...games.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}
