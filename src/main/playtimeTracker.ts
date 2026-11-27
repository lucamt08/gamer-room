// Compteur de temps de jeu.
//
// Toutes les 10 secondes, on regarde la liste des programmes ouverts sur le PC (comme le
// Gestionnaire des tâches). Si le programme d'un jeu de la bibliothèque est ouvert, on ajoute
// le temps écoulé à son compteur. Peu importe comment le jeu a été lancé (Gamer Room, raccourci
// du bureau, double-clic sur le .exe…) : tant que Gamer Room tourne, la partie est comptée.
// On ne touche jamais au jeu : on regarde seulement s'il est ouvert.
//
// Le temps est enregistré dans library.json chaque minute et à la fin de chaque partie
// (en cas de plantage ou de coupure de courant, on perd au pire une minute).
//
// Jeux Steam : on relit aussi le temps de jeu de Steam (voir steamPlaytime.ts) ; c'est ce
// chiffre-là qu'on affiche. Notre compteur sert de secours si le fichier de Steam est illisible.

import { basename } from 'node:path'
import type { Game } from '@shared/types'
import * as wm from './windowManager'
import { addPlaytime, getGames, updateGame } from './library'
import { isInside, samePath } from './launchLearning'
import { isKnownLauncherExe } from './knownLaunchers'
import { readSteamPlaytimes } from './steamPlaytime'

const SCAN_INTERVAL = 10_000 // on regarde les programmes ouverts toutes les 10 s
const SAVE_INTERVAL = 60_000 // on enregistre le temps compté chaque minute

/**
 * Programmes rangés dans le dossier d'un jeu qui ne sont PAS le jeu : launchers, outils de rapport
 * de plantage, installateurs, anti-cheat… (utilisé quand on reconnaît un jeu par son dossier).
 */
const NOT_THE_GAME = /launch|crash|report|unins|setup|redist|updater|helper|easyanticheat|battleye|cefprocess|webhelper/i

/** Chemin du .exe de chaque processus déjà vu (lire un chemin coûte un peu : on le garde). */
const pathCache = new Map<number, { exeName: string; path: string | null }>()
/** Jeux vus ouverts à la vérification précédente. */
let runningBefore = new Set<string>()
/** Temps compté mais pas encore enregistré (id du jeu → secondes). */
const unsaved = new Map<string, number>()
let lastScanAt = 0
let lastSaveAt = Date.now()
let timer: NodeJS.Timeout | null = null
let onUpdated: (game: Game) => void = () => {}

/** Démarre le compteur. `onGameUpdated` prévient l'interface quand un jeu change (temps, date…). */
export function startPlaytimeTracker(onGameUpdated: (game: Game) => void): void {
  onUpdated = onGameUpdated
  if (timer) return
  scan()
  timer = setInterval(scan, SCAN_INTERVAL)
}

/** Enregistre tout de suite le temps compté (à appeler quand Gamer Room se ferme). */
export function savePlaytimeNow(): void {
  for (const [gameId, seconds] of unsaved) {
    const game = addPlaytime(gameId, seconds)
    if (game) onUpdated(game)
  }
  unsaved.clear()
  lastSaveAt = Date.now()
}

/** Chemin du .exe d'un processus, avec cache (on vérifie que le pid n'a pas été réutilisé). */
function pathOf(process: wm.ProcessInfo): string | null {
  const cached = pathCache.get(process.pid)
  if (cached && cached.exeName === process.exeName) return cached.path
  const path = wm.getProcessPath(process.pid)
  pathCache.set(process.pid, { exeName: process.exeName, path })
  return path
}

/** Ce programme (chemin complet de son .exe) est-il ce jeu ? */
export function isGameProcess(game: Game, path: string): boolean {
  // Le vrai .exe du jeu (connu à l'ajout, ou appris au premier lancement depuis Gamer Room)
  if (samePath(path, game.realExePath)) return true

  // Reconnaissance par le dossier d'installation (on ignore les launchers, outils, anti-cheat…,
  // et les launchers connus comme le salon de League of Legends : voir knownLaunchers.ts)
  const inGameFolder = (): boolean =>
    !!game.gameFolder && isInside(path, game.gameFolder) && !NOT_THE_GAME.test(basename(path)) && !isKnownLauncherExe(path)

  switch (game.launchKind) {
    case 'steam':
    case 'store': // Epic, Battle.net, Riot : comme Steam, on reconnaît le jeu à son dossier
      return inGameFolder()
    case 'launcher':
      // Le temps passé dans le launcher ne compte pas. Si on ne connaît pas encore le vrai jeu,
      // on prend un programme de son dossier qui n'est pas le launcher.
      return !game.realExePath && !samePath(path, game.exePath) && inGameFolder()
    case 'relay':
      return !game.realExePath && samePath(path, game.exePath)
    default:
      return samePath(path, game.exePath)
  }
}

/** Une vérification : quels jeux sont ouverts, et combien de temps s'est écoulé. */
function scan(): void {
  try {
    const now = Date.now()
    // Si l'écart est anormalement grand (PC en veille), on ne compte qu'un intervalle normal
    const elapsed = lastScanAt ? Math.min(now - lastScanAt, SCAN_INTERVAL * 1.5) / 1000 : 0
    lastScanAt = now

    // 1. Programmes ouverts (et oubli des processus fermés)
    const processes = wm.snapshotProcesses()
    for (const pid of pathCache.keys()) if (!processes.has(pid)) pathCache.delete(pid)
    const paths: string[] = []
    for (const process of processes.values()) {
      const path = pathOf(process)
      if (path) paths.push(path)
    }

    // 2. Jeux ouverts en ce moment
    const games = getGames()
    const runningNow = new Set<string>()
    for (const game of games) {
      if (paths.some((path) => isGameProcess(game, path))) runningNow.add(game.id)
    }

    // 3. Temps écoulé : compté seulement si le jeu était déjà ouvert à la vérification précédente
    for (const gameId of runningNow) {
      if (!runningBefore.has(gameId)) {
        console.log(`[temps de jeu] "${games.find((g) => g.id === gameId)?.name}" est ouvert`)
        continue
      }
      unsaved.set(gameId, (unsaved.get(gameId) ?? 0) + elapsed)
    }

    // 4. Un jeu vient de se fermer : on enregistre tout de suite (l'interface affiche le nouveau total)
    const someGameClosed = [...runningBefore].some((id) => !runningNow.has(id))
    runningBefore = runningNow
    if (someGameClosed || now - lastSaveAt >= SAVE_INTERVAL) savePlaytimeNow()

    // 5. Temps de jeu Steam (le fichier n'est relu que s'il a changé)
    refreshSteamPlaytimes()
  } catch (error) {
    console.error('[temps de jeu] Erreur pendant la vérification', error)
  }
}

/** Recopie dans la bibliothèque le temps de jeu enregistré par Steam, s'il a changé. */
function refreshSteamPlaytimes(): void {
  const steam = readSteamPlaytimes()
  if (!steam) return // Steam absent ou fichier illisible : on garde les dernières valeurs connues
  for (const game of getGames()) {
    if (!game.steamAppId) continue
    const info = steam.get(game.steamAppId)
    const minutes = info?.minutes ?? 0 // pas dans le fichier = jamais joué sur ce compte
    const patch: Partial<Game> = {}
    if (game.steamPlaytimeMinutes !== minutes) patch.steamPlaytimeMinutes = minutes
    // Partie lancée depuis Steam plus récente que celle qu'on connaît : on met la date à jour
    if (info?.lastPlayed && (!game.lastPlayedAt || info.lastPlayed > new Date(game.lastPlayedAt))) {
      patch.lastPlayedAt = info.lastPlayed.toISOString()
    }
    if (Object.keys(patch).length > 0) onUpdated(updateGame(game.id, patch))
  }
}
