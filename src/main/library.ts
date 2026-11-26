// La bibliothèque de jeux : une liste de jeux stockée dans userData/library.json.
// Pas de base de données pour le prototype, un simple fichier JSON suffit.

import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import { shell } from 'electron'
import type { Game, GamePatch, SteamGameEntry } from '@shared/types'
import { readJson, writeJson } from './jsonStore'
import { coverPath } from './covers'
import { readExeInfo } from './exeInfo'
import { detectLaunchKind } from './launcherDetect'

const FILE = 'library.json'

interface LibraryFile {
  games: Game[]
}

let games: Game[] | null = null

function load(): Game[] {
  if (!games) games = readJson<LibraryFile>(FILE, { games: [] }).games
  return games
}

function save(): void {
  writeJson(FILE, { games: load() } satisfies LibraryFile)
}

export function getGames(): Game[] {
  return load()
}

export function getGame(id: string): Game | undefined {
  return load().find((g) => g.id === id)
}

/**
 * Si le chemin est un raccourci Windows (.lnk), renvoie la cible et ses
 * arguments. Electron sait lire les raccourcis tout seul (shell.readShortcutLink).
 */
function resolveShortcut(path: string): { target: string; args: string; cwd: string } | null {
  if (extname(path).toLowerCase() !== '.lnk') return null
  const link = shell.readShortcutLink(path)
  return { target: link.target, args: link.args ?? '', cwd: link.cwd ?? '' }
}

/** Transforme "my_super-game.exe" en "my super game" (nom proposé par défaut). */
export function guessName(path: string): string {
  return basename(path, extname(path)).replace(/[_\-.]+/g, ' ').trim()
}

/**
 * Ajoute un jeu à partir d'un chemin de .exe ou de .lnk.
 * Lance une erreur (en français) si le fichier n'est pas utilisable.
 */
export function addGameFromPath(path: string): Game {
  const ext = extname(path).toLowerCase()
  if (ext !== '.exe' && ext !== '.lnk') {
    throw new Error('Seuls les fichiers .exe et les raccourcis .lnk sont acceptés.')
  }

  let exePath = path
  let args = ''
  let workingDir = dirname(path)
  // Pour un raccourci, on garde le nom du raccourci (souvent plus joli que le nom de l'exe)
  const name = guessName(path)

  const shortcut = resolveShortcut(path)
  if (shortcut) {
    if (!shortcut.target || extname(shortcut.target).toLowerCase() !== '.exe') {
      throw new Error("Ce raccourci ne pointe pas vers un .exe (c'est peut-être un lien web ou Steam).")
    }
    exePath = shortcut.target
    args = shortcut.args
    workingDir = shortcut.cwd || dirname(shortcut.target)
  }

  if (!existsSync(exePath)) {
    throw new Error(`Fichier introuvable : ${exePath}`)
  }

  const info = readExeInfo(exePath)
  // Le jeu lui-même, un launcher ou un relais ? (voir launcherDetect.ts)
  const launch = detectLaunchKind(exePath, info)
  const game: Game = {
    id: randomUUID(),
    name,
    exePath,
    args,
    workingDir,
    coverFile: null,
    steamGridDbId: null,
    forceFullscreen: true,
    addedAt: new Date().toISOString(),
    lastPlayedAt: null,
    // Éditeur lu dans la carte d'identité du .exe (pour la future fiche d'infos du jeu).
    // Pour un launcher, on préfère l'éditeur du vrai jeu.
    publisher: (launch.realExePath && readExeInfo(launch.realExePath).publisher) || info.publisher,
    launchKind: launch.kind,
    realExePath: launch.realExePath,
    gameFolder: launch.gameFolder
  }
  load().push(game)
  save()
  return game
}

/**
 * Pour les jeux ajoutés avant la détection des launchers : on la fait maintenant
 * (appelé juste avant le lancement). Renvoie le jeu à jour.
 */
export function ensureLaunchInfo(game: Game): Game {
  if (game.launchKind) return game
  const launch = detectLaunchKind(game.exePath)
  return updateGame(game.id, {
    launchKind: launch.kind,
    realExePath: launch.realExePath,
    gameFolder: launch.gameFolder
  })
}

/** Ajoute des jeux Steam (choisis dans la fenêtre d'import). Les jeux déjà présents sont ignorés. */
export function addSteamGames(entries: SteamGameEntry[], steamExe: string): Game[] {
  const added: Game[] = []
  for (const entry of entries) {
    if (load().some((g) => g.steamAppId === entry.appId)) continue
    const game: Game = {
      id: randomUUID(),
      name: entry.name,
      // On demande à Steam de lancer le jeu : steam.exe -applaunch <numéro du jeu>
      exePath: steamExe,
      args: `-applaunch ${entry.appId}`,
      workingDir: dirname(steamExe),
      coverFile: null,
      steamGridDbId: null,
      forceFullscreen: true,
      addedAt: new Date().toISOString(),
      lastPlayedAt: null,
      publisher: null, // appris au premier lancement (carte d'identité du vrai .exe)
      launchKind: 'steam',
      realExePath: null,
      gameFolder: entry.installDir,
      steamAppId: entry.appId
    }
    load().push(game)
    added.push(game)
  }
  save()
  return added
}

/** Modifie un jeu (nom, arguments, option plein écran) et renvoie la version à jour. */
export function updateGame(id: string, patch: GamePatch | Partial<Game>): Game {
  const game = getGame(id)
  if (!game) throw new Error('Jeu introuvable.')
  Object.assign(game, patch)
  save()
  return game
}

/** Supprime un jeu de la bibliothèque (et sa jaquette en cache). Le jeu lui-même n'est PAS désinstallé. */
export function removeGame(id: string): void {
  const game = getGame(id)
  if (!game) return
  if (game.coverFile) rmSync(coverPath(game.coverFile), { force: true })
  games = load().filter((g) => g.id !== id)
  save()
}
