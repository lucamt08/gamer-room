// Suivi des jeux Epic : installé ou non installé.
//
// Toutes les 10 secondes, on relit la liste des jeux Epic installés (voir epicGames.ts) :
//  - un jeu de Gamer Room vient d'être installé dans Epic → il devient jouable (dossier, vrai .exe, taille) ;
//  - un jeu a été désinstallé dans Epic → il repasse en « Non installé » (bouton « Installer »).
// (Epic n'écrit pas l'avancement du téléchargement : pas de pourcentage, contrairement à Steam.)

import { basename } from 'node:path'
import type { Game } from '@shared/types'
import { getGames, updateGame } from '../library'
import { listEpicGames } from './epicGames'

const CHECK_INTERVAL = 10_000

let timer: NodeJS.Timeout | null = null

/** Démarre le suivi. `onGameUpdated` prévient l'interface quand un jeu change. */
export function startEpicInstallWatcher(onGameUpdated: (game: Game) => void): void {
  if (timer) return
  const check = (): void => {
    try {
      const epicGames = getGames().filter((g) => g.source === 'epic' && g.storeId)
      if (epicGames.length === 0) return
      const installed = new Map(listEpicGames().map((g) => [g.appName, g]))

      for (const game of epicGames) {
        const found = installed.get(game.storeId!)
        const patch: Partial<Game> = {}
        if (found) {
          if (game.installed === false) {
            console.log(`[epic] "${game.name}" est installé`)
            patch.installed = true
          }
          if (game.gameFolder !== found.folder) {
            patch.gameFolder = found.folder
            patch.workingDir = found.folder
            // Le vrai jeu (sauf un petit launcher comme FortniteLauncher.exe : on reconnaît alors le jeu à son dossier)
            patch.realExePath = /launch/i.test(basename(found.exePath)) ? null : found.exePath
          }
          if (found.sizeBytes && (game.sizeBytes !== found.sizeBytes || game.sizeIsEstimate)) {
            patch.sizeBytes = found.sizeBytes
            patch.sizeIsEstimate = false
          }
        } else if (game.installed !== false) {
          console.log(`[epic] "${game.name}" n'est pas installé`)
          patch.installed = false
          patch.gameFolder = null
        }
        if (Object.keys(patch).length > 0) onGameUpdated(updateGame(game.id, patch))
      }
    } catch (error) {
      console.error('[epic] Erreur pendant le suivi des installations', error)
    }
  }
  check()
  timer = setInterval(check, CHECK_INTERVAL)
}
