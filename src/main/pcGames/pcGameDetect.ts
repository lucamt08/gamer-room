// Détection générale des jeux .exe (jeux sans launcher, ou d'un launcher pas encore géré).
//
// Comme un détective, en 4 étapes :
//  1. LES SUSPECTS : les .exe que Windows a reconnus comme des jeux (Game Bar / Mode Jeu, dans le registre
//     HKCU\System\GameConfigStore\Children → MatchedExeFullPath), le .exe principal de chaque sous-dossier
//     des dossiers de jeux (D:\Games, C:\Jeux… + ceux choisis dans « + Jeux du PC »), et les raccourcis du
//     bureau et du menu Démarrer ;
//  2. ON ÉCARTE : dossiers système, jeux Steam / Epic / Battle.net / GOG (gérés à part), jeux déjà dans
//     Gamer Room, installateurs et outils, logiciels connus (éditeur Microsoft, Google, NVIDIA, Discord…) ;
//  3. UNE NOTE « est-ce un jeu ? » : chaque indice rapporte des points (moteur de jeu reconnu, reconnu par
//     Windows, dans un dossier de jeux, DLSS/FSR, fichiers Steam, gros .exe…) ;
//  4. LE NOM : carte d'identité du .exe ("Hades II"), sinon le nom du dossier (voir gameNames.ts).
//     La jaquette est ensuite cherchée chez SteamGridDB, comme pour un jeu ajouté à la main.
//
// Ce n'est jamais sûr à 100 % : les jeux sont PROPOSÉS (cochés si la note est haute), jamais ajoutés tout seuls.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, normalize } from 'node:path'
import { app, shell } from 'electron'
import type { DetectedGame } from '@shared/types'
import { readExeInfo } from '../exeInfo'
import { fallbackNames } from '../gameNames'
import { isInside } from '../launchLearning'
import { findMainExe, NOT_THE_GAME } from './mainExe'

/** Note minimale pour proposer un jeu coché (sûrement un jeu), et pour le proposer décoché (à vérifier). */
const HIGH_SCORE = 4
const MEDIUM_SCORE = 2

/** Noms de dossiers de jeux habituels, cherchés à la racine de chaque disque. */
const USUAL_GAME_FOLDERS = ['Games', 'Jeux', 'Game', 'Jeux vidéo', 'Jeux video']

/** Éditeurs de logiciels qui ne sont pas des jeux (navigateurs, pilotes, outils…). */
const SOFTWARE_PUBLISHERS =
  /^(microsoft corporation|google|adobe|nvidia|advanced micro devices|amd|intel|discord|mozilla|oracle|logitech|razer|corsair|realtek|valve|epic games|riot games|overwolf|obs project|spotify|github|electron|python|elgato|steelseries)/i

/** Les launchers eux-mêmes (ce ne sont pas des jeux). */
const LAUNCHER_EXES =
  /^(steam|epicgameslauncher|battle\.net|galaxyclient|riotclientservices|riotclientux|leagueclient(ux)?|upc|ubisoftconnect|eadesktop|origin|playnite.*|gog galaxy)\.exe$/i

/** Dossiers intermédiaires sans intérêt pour trouver le dossier "racine" d'un jeu. */
const GENERIC_DIRS = /^(bin|bin64|binaries|win64|win32|x64|x86|ship|shipping|retail|game|release|build)$/i

/** Ce qu'il faut savoir pour exclure les jeux déjà connus. */
export interface Exclusions {
  /** Dossiers déjà couverts (jeux de Gamer Room, jeux Epic / Battle.net / GOG). */
  folders: string[]
  /** .exe déjà dans Gamer Room (en minuscules). */
  exes: Set<string>
}

/** Un suspect : un .exe, et d'où on le connaît. */
interface Candidate {
  exe: string
  fromWindows: boolean
  inGamesFolder: boolean
}

// ----------------------------------------------------------------------------
//  1. Les suspects
// ----------------------------------------------------------------------------

/** .exe reconnus comme des jeux par Windows (Game Bar / Mode Jeu). */
function exesFromWindows(): string[] {
  try {
    const output = execFileSync('reg', ['query', 'HKCU\\System\\GameConfigStore\\Children', '/s', '/v', 'MatchedExeFullPath'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
    return [...output.matchAll(/MatchedExeFullPath\s+REG_SZ\s+(.+)/g)].map((m) => m[1].trim()).filter((p) => p.length > 0)
  } catch {
    return []
  }
}

/** Dossiers de jeux : ceux choisis à la main + les dossiers habituels (D:\Games, C:\Jeux…) qui existent. */
export function gameFolders(chosen: string[]): string[] {
  const folders = [...chosen]
  for (let code = 67; code <= 90; code++) {
    // C: à Z:
    const drive = `${String.fromCharCode(code)}:\\`
    if (!existsSync(drive)) continue
    for (const name of USUAL_GAME_FOLDERS) {
      const folder = join(drive, name)
      if (existsSync(folder)) folders.push(folder)
    }
  }
  return [...new Map(folders.map((f) => [f.toLowerCase(), f])).values()]
}

/** Le .exe principal de chaque sous-dossier d'un dossier de jeux (un sous-dossier = un jeu). */
function exesFromGameFolder(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => findMainExe(join(folder, entry.name)))
      .filter((exe): exe is string => !!exe)
  } catch {
    return []
  }
}

/** .exe visés par les raccourcis du bureau et du menu Démarrer. */
function exesFromShortcuts(): string[] {
  const env = process.env
  const places = [
    app.getPath('desktop'),
    env['PUBLIC'] && join(env['PUBLIC'], 'Desktop'),
    env['APPDATA'] && join(env['APPDATA'], 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    env['ProgramData'] && join(env['ProgramData'], 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ].filter((p): p is string => !!p)

  const exes: string[] = []
  const walk = (dir: string, depth: number): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory() && depth < 2) walk(path, depth + 1)
      else if (entry.name.toLowerCase().endsWith('.lnk')) {
        try {
          const target = shell.readShortcutLink(path).target
          if (target.toLowerCase().endsWith('.exe')) exes.push(target)
        } catch {
          // raccourci cassé ou vers autre chose qu'un fichier
        }
      }
    }
  }
  for (const place of places) walk(place, 0)
  return exes
}

// ----------------------------------------------------------------------------
//  2. On écarte
// ----------------------------------------------------------------------------

/** Ce .exe est-il à écarter d'office ? */
function isExcluded(exe: string, exclusions: Exclusions): boolean {
  const lower = exe.toLowerCase()
  const name = basename(exe)
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows'
  return (
    !existsSync(exe) ||
    exclusions.exes.has(lower) ||
    NOT_THE_GAME.test(name) ||
    LAUNCHER_EXES.test(name) ||
    isInside(exe, systemRoot) ||
    lower.includes('\\windowsapps\\') || // applis du Microsoft Store (protégées)
    lower.includes('\\steamapps\\') || // jeux Steam : gérés par « + Jeux Steam »
    exclusions.folders.some((folder) => isInside(exe, folder))
  )
}

// ----------------------------------------------------------------------------
//  3. La note « est-ce un jeu ? »
// ----------------------------------------------------------------------------

/** Dossier "racine" du jeu : on remonte les dossiers techniques (bin, Binaries\Win64…) et le dossier du moteur. */
export function gameRoot(exe: string): string {
  let folder = dirname(exe)
  for (let i = 0; i < 4 && GENERIC_DIRS.test(basename(folder)) && dirname(folder) !== folder; i++) folder = dirname(folder)
  // Jeu Unreal : <jeu>\<Projet>\Binaries\Win64\…  → la racine est le dossier qui contient "Engine"
  if (!existsSync(join(folder, 'Engine')) && existsSync(join(dirname(folder), 'Engine'))) folder = dirname(folder)
  return folder
}

/** Noms des fichiers d'un dossier, en minuscules (vide si illisible). */
function fileNames(folder: string): Set<string> {
  try {
    return new Set(readdirSync(folder).map((name) => name.toLowerCase()))
  } catch {
    return new Set()
  }
}

/** Indices qu'un .exe est un jeu : liste de [raison affichée, points]. */
function gameSignals(candidate: Candidate, root: string): [string, number][] {
  const signals: [string, number][] = []
  const exeDir = dirname(candidate.exe)
  const files = fileNames(exeDir)
  const rootFiles = root === exeDir ? files : fileNames(root)
  const exeName = basename(candidate.exe, '.exe').toLowerCase()

  // Moteurs de jeu
  if (files.has('unityplayer.dll') || files.has('gameassembly.dll')) signals.push(['moteur Unity', 3])
  else if (/-win64-shipping$/.test(exeName) || rootFiles.has('engine')) signals.push(['moteur Unreal', 3])
  else if (files.has(`${exeName}.pck`)) signals.push(['moteur Godot', 3])
  else if (files.has('data.win')) signals.push(['GameMaker', 3])
  else if (files.has('www') || [...files].some((f) => f.endsWith('.rgss3a') || f.endsWith('.rgssad'))) signals.push(['RPG Maker', 3])
  else if (files.has('renpy') || rootFiles.has('renpy')) signals.push(["Ren'Py", 3])

  if (candidate.fromWindows) signals.push(['reconnu comme jeu par Windows', 3])
  if (candidate.inGamesFolder) signals.push(['dans un dossier de jeux', 2])
  if (files.has('nvngx_dlss.dll') || files.has('amd_fidelityfx_dx12.dll') || files.has('libxess.dll')) signals.push(['DLSS / FSR', 2])
  if (files.has('steam_api64.dll') || files.has('steam_api.dll')) signals.push(['fichiers Steam', 2])
  try {
    if (statSync(candidate.exe).size >= 30 * 1024 * 1024) signals.push(['gros .exe', 1])
  } catch {
    // ignoré
  }
  return signals
}

// ----------------------------------------------------------------------------
//  Tout ensemble
// ----------------------------------------------------------------------------

/** Jeux .exe trouvés sur le PC (pas encore dans Gamer Room), du plus sûr au moins sûr. */
export function detectPcGames(chosenFolders: string[], exclusions: Exclusions): DetectedGame[] {
  // 1. Les suspects (sans doublon)
  const candidates = new Map<string, Candidate>()
  const add = (exe: string, from: Partial<Candidate>): void => {
    const path = normalize(exe)
    const key = path.toLowerCase()
    const current = candidates.get(key) ?? { exe: path, fromWindows: false, inGamesFolder: false }
    candidates.set(key, { ...current, fromWindows: current.fromWindows || !!from.fromWindows, inGamesFolder: current.inGamesFolder || !!from.inGamesFolder })
  }
  for (const exe of exesFromWindows()) add(exe, { fromWindows: true })
  for (const folder of gameFolders(chosenFolders)) for (const exe of exesFromGameFolder(folder)) add(exe, { inGamesFolder: true })
  for (const exe of exesFromShortcuts()) add(exe, {})

  // 2, 3 et 4 : on écarte, on note, on nomme. Un seul jeu par dossier racine (le mieux noté).
  const byRoot = new Map<string, DetectedGame & { score: number }>()
  for (const candidate of candidates.values()) {
    if (isExcluded(candidate.exe, exclusions)) continue
    const info = readExeInfo(candidate.exe)
    if (info.publisher && SOFTWARE_PUBLISHERS.test(info.publisher)) continue

    const root = gameRoot(candidate.exe)
    const signals = gameSignals(candidate, root)
    const score = signals.reduce((total, [, points]) => total + points, 0)
    if (score < MEDIUM_SCORE) continue

    const game = {
      key: `pc:${candidate.exe.toLowerCase()}`,
      source: 'pc' as const,
      name: fallbackNames(candidate.exe, info)[0] ?? basename(root),
      folder: root,
      exePath: candidate.exe,
      sizeBytes: null,
      confidence: score >= HIGH_SCORE ? ('high' as const) : ('medium' as const),
      reasons: signals.map(([reason]) => reason),
      score
    }
    const existing = byRoot.get(root.toLowerCase())
    if (!existing || score > existing.score) byRoot.set(root.toLowerCase(), game)
  }
  return [...byRoot.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'))
    .map(({ score: _score, ...game }) => game)
}
