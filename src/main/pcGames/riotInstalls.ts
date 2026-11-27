// Suivi des jeux Riot Games : installé ou non installé.
//
// Toutes les 10 secondes, on relit la liste des jeux Riot installés (voir riotGames.ts) :
//  - un jeu de Gamer Room vient d'être installé dans le Riot Client → il devient jouable (dossier, vrai .exe, taille) ;
//  - un jeu a été désinstallé → il repasse en « Non installé » (bouton « Installer », ses heures restent affichées) ;
//  - le Riot Client a été déplacé → on met à jour la commande de lancement.
// (Riot n'écrit pas l'avancement du téléchargement : pas de pourcentage, contrairement à Steam.)

import type { Game } from '@shared/types'
import { getGames, updateGame } from '../library'
import { isKnownLauncherExe } from '../knownLaunchers'
import { findRiotClient, listRiotGames } from './riotGames'

const CHECK_INTERVAL = 10_000

let timer: NodeJS.Timeout | null = null

/** Démarre le suivi. `onGameUpdated` prévient l'interface quand un jeu change. */
export function startRiotInstallWatcher(onGameUpdated: (game: Game) => void): void {
  if (timer) return
  const check = (): void => {
    try {
      const riotGames = getGames().filter((g) => g.source === 'riot' && g.storeId)
      if (riotGames.length === 0) return
      const client = findRiotClient()
      if (!client) return // Riot Client introuvable : on ne touche à rien
      const installed = new Map(listRiotGames().map((g) => [g.riotId, g]))

      for (const game of riotGames) {
        const found = installed.get(game.storeId!)
        const patch: Partial<Game> = {}
        if (game.exePath !== client) patch.exePath = client
        if (found) {
          if (game.installed === false) {
            console.log(`[riot] "${game.name}" est installé`)
            patch.installed = true
          }
          if (game.gameFolder !== found.folder) {
            patch.gameFolder = found.folder
            patch.workingDir = found.folder
            patch.realExePath = isKnownLauncherExe(found.exePath) ? null : found.exePath
          }
          // Taille notée par Riot, seulement si on n'en a pas encore (sinon : taille du dossier, voir gameSizes.ts)
          if (found.sizeBytes && !game.sizeBytes) {
            patch.sizeBytes = found.sizeBytes
            patch.sizeIsEstimate = false
          }
        } else if (game.installed !== false) {
          console.log(`[riot] "${game.name}" n'est pas installé`)
          patch.installed = false
          patch.gameFolder = null
          patch.realExePath = null
          patch.sizeBytes = null
        }
        if (Object.keys(patch).length > 0) onGameUpdated(updateGame(game.id, patch))
      }
    } catch (error) {
      console.error('[riot] Erreur pendant le suivi des installations', error)
    }
  }
  check()
  timer = setInterval(check, CHECK_INTERVAL)
}
