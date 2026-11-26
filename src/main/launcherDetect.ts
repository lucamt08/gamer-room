// Devine, à l'ajout d'un jeu, si le .exe choisi est le jeu lui-même, un launcher ou un "relais".
//
// Exemples sur de vrais jeux :
//   Cyberpunk 2077\REDprelauncher.exe → 'launcher', vrai jeu : bin\x64\Cyberpunk2077.exe
//   Black Myth Wukong\b1.exe          → 'relay',    vrai jeu : b1\Binaries\Win64\b1-Win64-Shipping.exe
//   LongshotLauncher.exe              → 'launcher', vrai jeu lu dans la config de Longshot (builds.json)
//   Ghost of Tsushima\GhostOfTsushima.exe → 'game'
//
// Les indices utilisés :
//  - des mots comme "launcher", "bootstrap", "loader" dans le nom ou la carte d'identité du .exe ;
//  - les briques typiques des launchers à côté du .exe (Qt, Chromium/CEF, Electron) ;
//  - un tout petit .exe avec, dans ses sous-dossiers, un .exe bien plus gros qui ressemble au jeu.
// Ce n'est qu'une première idée : au lancement, gameLauncher.ts regarde quel programme ouvre
// vraiment la fenêtre du jeu et corrige si besoin (voir launchLearning.ts).
//
// Pas d'Electron ni de réseau ici, juste la lecture de fichiers.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { homedir } from 'node:os'
import type { LaunchKind } from '@shared/types'
import { readExeInfo, type ExeInfo } from './exeInfo'
import { isGenericName, isSameName } from './gameNames'

export interface LaunchDetection {
  kind: LaunchKind
  /** Le vrai .exe du jeu, s'il a été trouvé. */
  realExePath: string | null
  /** Le dossier du jeu, s'il est connu. */
  gameFolder: string | null
  /** Noms possibles du vrai jeu trouvés en chemin (ex. dans la config d'un launcher). */
  nameHints: string[]
}

/** Mots qui trahissent un launcher dans le nom ou la carte d'identité du .exe. */
const LAUNCHER_WORDS = /launch|bootstrap|loader|starter/i

/** Fichiers typiques des launchers (interfaces faites avec Qt, Chromium ou Electron). */
const LAUNCHER_FILES = ['Qt5Core.dll', 'Qt6Core.dll', 'libcef.dll', 'chrome_elf.dll', join('resources', 'app.asar')]

/** .exe qui ne sont jamais le jeu : installateurs, rapports de plantage, anti-triche, launchers... */
const NOT_THE_GAME =
  /setup|unins|install|redist|dotnet|ndp\d|dxsetup|crash|report|helper|updater|uploader|handler|prompt|launch|bootstrap|anticheat|battleye|cef|service|benchmark/i

/** Dossiers qu'on ne fouille pas (installateurs, outils). */
const SKIPPED_FOLDERS = /^(_?redist|_commonredist|__installer|directx|support|installers?|\.[^.]+)$/i

/** Un .exe "gros" fait au moins 20 Mo. */
const BIG_EXE = 20 * 1024 * 1024

/** Un relais fait moins de 3 Mo. */
const SMALL_EXE = 3 * 1024 * 1024

/** Liste les .exe d'un dossier et de ses sous-dossiers (4 niveaux maximum). */
function listExes(folder: string, depth = 0, out: { path: string; size: number }[] = []): { path: string; size: number }[] {
  if (depth > 4 || out.length > 500) return out
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.test(entry.name)) listExes(path, depth + 1, out)
    } else if (extname(entry.name).toLowerCase() === '.exe') {
      try {
        out.push({ path, size: statSync(path).size })
      } catch {
        // fichier illisible : on l'ignore
      }
    }
  }
  return out
}

/**
 * Cherche le vrai jeu sous le dossier du launcher : le .exe le plus "jeu" parmi les gros .exe.
 * On préfère les .exe Unreal Engine ("…-Shipping.exe") et ceux qui portent le nom du dossier ou du produit.
 */
function findRealExe(launcherPath: string, launcherSize: number, info: ExeInfo): string | null {
  const folder = dirname(launcherPath)
  const folderName = basename(folder)
  const candidates = listExes(folder).filter(
    (exe) =>
      exe.path.toLowerCase() !== launcherPath.toLowerCase() &&
      exe.size >= Math.max(BIG_EXE, launcherSize * 3) &&
      !NOT_THE_GAME.test(basename(exe.path))
  )
  const score = (exe: { path: string }): number => {
    const name = basename(exe.path, '.exe')
    let points = 0
    if (/-shipping$/i.test(name)) points += 3
    if (isSameName(name, folderName) || (info.productName && isSameName(name, info.productName))) points += 2
    return points
  }
  candidates.sort((a, b) => score(b) - score(a) || b.size - a.size)
  return candidates[0]?.path ?? null
}

/**
 * Longshot (recompilation de jeux Switch) : le launcher note dans
 * %LOCALAPPDATA%\LongshotLauncher\builds.json où se trouve le jeu recompilé et le fichier du jeu d'origine.
 */
function readLongshot(): LaunchDetection | null {
  const home = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'LongshotLauncher')
  try {
    const builds = JSON.parse(readFileSync(join(home, 'builds.json'), 'utf8')) as {
      builds?: Array<{ folder?: string; nup?: string; default?: boolean }>
    }
    const build = builds.builds?.find((b) => b.default) ?? builds.builds?.[0]
    if (!build?.folder) return null
    const realExe = join(build.folder, 'bin', 'longshot.exe')
    const nameHints: string[] = []
    // "D:\jeux\...\games\Zelda ocarina of time.nup" → "Zelda ocarina of time"
    if (build.nup) nameHints.push(basename(build.nup, extname(build.nup)))
    // Dossier des builds : "D:\jeux\Legend of Zelda Ocarina of time pc\stable\v3.2.0" → "Legend of Zelda Ocarina of time pc"
    // (on remonte en sautant "v3.2.0", "stable"...)
    let folder = build.folder
    while (dirname(folder) !== folder && isGenericName(basename(folder))) folder = dirname(folder)
    if (dirname(folder) !== folder) nameHints.push(basename(folder))
    return {
      kind: 'launcher',
      realExePath: existsSync(realExe) ? realExe : null,
      gameFolder: build.folder,
      nameHints
    }
  } catch {
    return null
  }
}

/** Devine ce que lance un .exe. Ne lance jamais d'erreur (au pire : 'game'). */
export function detectLaunchKind(exePath: string, info: ExeInfo = readExeInfo(exePath)): LaunchDetection {
  const game: LaunchDetection = { kind: 'game', realExePath: null, gameFolder: null, nameHints: [] }
  try {
    // Launchers connus qui rangent leur jeu ailleurs
    if (/^longshot launcher$/i.test(info.productName ?? '')) return readLongshot() ?? { ...game, kind: 'launcher' }

    const size = statSync(exePath).size
    const folder = dirname(exePath)
    const text = [basename(exePath), info.productName, info.fileDescription].join(' ')
    const looksLikeLauncher =
      LAUNCHER_WORDS.test(text) || LAUNCHER_FILES.some((file) => existsSync(join(folder, file)))

    const realExe = findRealExe(exePath, size, info)
    // Petit "bootstrap" Unreal Engine (ex. b1.exe de Wukong) : un relais sans fenêtre
    if (size < SMALL_EXE && realExe && /bootstrap/i.test(text)) {
      return { kind: 'relay', realExePath: realExe, gameFolder: folder, nameHints: [] }
    }
    if (looksLikeLauncher && realExe) {
      return { kind: 'launcher', realExePath: realExe, gameFolder: folder, nameHints: [] }
    }
    // Petit .exe sans carte d'identité (ou un "…-Shipping.exe" Unreal à côté) : c'est un relais
    const noInfo = !info.productName && !info.fileDescription
    if (size < SMALL_EXE && realExe && (noInfo || /-shipping\.exe$/i.test(realExe))) {
      return { kind: 'relay', realExePath: realExe, gameFolder: folder, nameHints: [] }
    }
    // Un launcher dont on n'a pas trouvé le jeu : on l'apprendra au premier lancement
    if (looksLikeLauncher && LAUNCHER_FILES.some((file) => existsSync(join(folder, file)))) {
      return { ...game, kind: 'launcher' }
    }
    return game
  } catch {
    return game
  }
}
