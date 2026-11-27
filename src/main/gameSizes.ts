// Taille des jeux qui ne viennent pas de Steam : on additionne la taille des fichiers de leur dossier.
// (Pour les jeux Steam, la taille vient des fichiers de Steam : voir steamInstalls.ts.)
//
// Le calcul se fait en arrière-plan, un jeu après l'autre, sans bloquer l'appli. Il est refait au plus
// une fois par jour (un jeu change de taille seulement lors d'une mise à jour).
// On ne calcule jamais la taille d'un dossier système (ex. C:\Windows\System32 pour le Bloc-notes) :
// ce ne serait pas la taille du jeu.

import { readdir, lstat } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import type { Game } from '@shared/types'
import { getGames, updateGame } from './library'
import { isInside } from './launchLearning'

const RECHECK_AFTER = 24 * 60 * 60 * 1000 // on recalcule au plus une fois par jour
const START_DELAY = 20_000 // on attend 20 s après le démarrage (l'appli a mieux à faire avant)

let running = false

/** Dossier du jeu dont on peut calculer la taille, ou null (dossier système, disque entier…). */
function folderToMeasure(game: Game): string | null {
  const folder = game.gameFolder ?? dirname(game.exePath)
  const root = parse(folder).root
  if (folder.replace(/\\+$/, '').length <= root.replace(/\\+$/, '').length) return null // ex. "D:\"
  const forbidden = [process.env['SystemRoot'], process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(
    (p): p is string => !!p
  )
  const lower = folder.toLowerCase().replace(/\\+$/, '')
  // Le dossier Windows (et ses sous-dossiers), ou un dossier "Program Files" lui-même
  if (process.env['SystemRoot'] && (lower === process.env['SystemRoot'].toLowerCase() || isInside(folder, process.env['SystemRoot']))) return null
  if (forbidden.some((p) => lower === p.toLowerCase())) return null
  return folder
}

/** Taille totale d'un dossier, en octets (les raccourcis/liens symboliques ne sont pas suivis). */
async function folderSize(folder: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) total += await folderSize(path)
    else {
      try {
        total += (await lstat(path)).size
      } catch {
        // fichier verrouillé ou supprimé entre-temps
      }
    }
  }
  return total
}

/** Calcule la taille des jeux non-Steam qui n'en ont pas, ou dont la taille date de plus d'un jour. */
export async function updateGameSizes(onGameUpdated: (game: Game) => void): Promise<void> {
  if (running) return
  running = true
  try {
    for (const game of getGames()) {
      if (game.steamAppId) continue
      const checkedAt = game.sizeCheckedAt ? new Date(game.sizeCheckedAt).getTime() : 0
      if (Date.now() - checkedAt < RECHECK_AFTER) continue
      const folder = folderToMeasure(game)
      const size = folder ? await folderSize(folder) : 0
      // Le jeu a pu être supprimé pendant le calcul
      if (!getGames().some((g) => g.id === game.id)) continue
      onGameUpdated(updateGame(game.id, { sizeBytes: size || null, sizeIsEstimate: false, sizeCheckedAt: new Date().toISOString() }))
    }
  } catch (error) {
    console.error('[taille] Erreur pendant le calcul des tailles', error)
  } finally {
    running = false
  }
}

/** Lance le calcul des tailles un peu après le démarrage de l'appli. */
export function startGameSizes(onGameUpdated: (game: Game) => void): void {
  setTimeout(() => updateGameSizes(onGameUpdated), START_DELAY)
}
