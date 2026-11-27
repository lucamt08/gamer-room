// Suivi des jeux Battle.net : installé ou non installé.
//
// Toutes les 10 secondes, on relit la liste des jeux Battle.net installés (product.db, voir battleNetGames.ts) :
//  - un jeu de Gamer Room vient d'être installé dans Battle.net → il devient jouable (dossier, vrai .exe) ;
//  - un jeu a été désinstallé → il repasse en « Non installé » (bouton « Installer », ses heures restent affichées).
// (Battle.net n'écrit pas l'avancement du téléchargement de façon simple : pas de pourcentage.)

import type { Game } from '@shared/types'
import { getGames, updateGame } from '../library'
import { isKnownLauncherExe } from '../knownLaunchers'
import { listBattleNetGames } from './battleNetGames'

const CHECK_INTERVAL = 10_000

let timer: NodeJS.Timeout | null = null

/** Démarre le suivi. `onGameUpdated` prévient l'interface quand un jeu change. */
export function startBattleNetInstallWatcher(onGameUpdated: (game: Game) => void): void {
  if (timer) return
  const check = (): void => {
    try {
      const games = getGames().filter((g) => g.source === 'battlenet' && g.storeId)
      if (games.length === 0) return
      const installed = new Map(listBattleNetGames().map((g) => [g.uid, g]))

      for (const game of games) {
        const found = installed.get(game.storeId!)
        const patch: Partial<Game> = {}
        if (found) {
          if (game.installed === false) {
            console.log(`[battle.net] "${game.name}" est installé`)
            patch.installed = true
          }
          if (game.gameFolder !== found.folder) {
            patch.gameFolder = found.folder
            patch.workingDir = found.folder
            patch.realExePath = /launch/i.test(found.exePath) || isKnownLauncherExe(found.exePath) ? null : found.exePath
          }
        } else if (game.installed !== false && game.launchKind === 'store') {
          // (Les anciens jeux Battle.net lancés par leur .exe ne sont pas suivis : on ne sait pas les réinstaller)
          console.log(`[battle.net] "${game.name}" n'est pas installé`)
          patch.installed = false
          patch.gameFolder = null
          patch.realExePath = null
          patch.sizeBytes = null
        }
        if (Object.keys(patch).length > 0) onGameUpdated(updateGame(game.id, patch))
      }
    } catch (error) {
      console.error('[battle.net] Erreur pendant le suivi des installations', error)
    }
  }
  check()
  timer = setInterval(check, CHECK_INTERVAL)
}
