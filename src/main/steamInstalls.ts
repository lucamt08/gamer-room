// Installation des jeux Steam depuis Gamer Room, et suivi de l'état installé / non installé.
//
//  - Bouton « Installer » : on ouvre le lien steam://install/<numéro du jeu>. Steam affiche alors sa
//    propre fenêtre d'installation (choix du disque…). Gamer Room ne télécharge rien elle-même.
//  - Toutes les 5 secondes, on relit les fichiers appmanifest de Steam (voir steamLibrary.ts) :
//      • téléchargement en cours → pourcentage envoyé à l'interface (barre de progression) ;
//      • installation terminée → le jeu devient jouable (dossier, taille exacte) ;
//      • jeu désinstallé dans Steam → il repasse en « Non installé » (ses heures restent affichées).

import { shell } from 'electron'
import type { Game, InstallProgress } from '@shared/types'
import { getGame, getGames, updateGame } from './library'
import { findSteamFolder, readManifests } from './steamLibrary'
import { readAppInfo } from './steamAppInfo'

const CHECK_INTERVAL = 5_000 // on relit les fichiers de Steam toutes les 5 s

let timer: NodeJS.Timeout | null = null
let lastProgress = '{}'

/** Ouvre la fenêtre d'installation de Steam pour ce jeu. */
export async function installSteamGame(gameId: string): Promise<void> {
  const game = getGame(gameId)
  if (!game?.steamAppId) throw new Error("Ce jeu n'est pas un jeu Steam.")
  await shell.openExternal(`steam://install/${game.steamAppId}`)
}

/**
 * Démarre le suivi. `onGameUpdated` prévient l'interface quand un jeu change (installé, taille…),
 * `onProgress` lui envoie l'avancement des téléchargements en cours.
 */
export function startSteamInstallWatcher(
  onGameUpdated: (game: Game) => void,
  onProgress: (progress: InstallProgress) => void
): void {
  if (timer) return
  const check = (): void => {
    try {
      refresh(onGameUpdated, onProgress)
    } catch (error) {
      console.error('[steam] Erreur pendant le suivi des installations', error)
    }
  }
  check()
  timer = setInterval(check, CHECK_INTERVAL)
}

/** Une vérification : état installé, taille et téléchargement de chaque jeu Steam de la bibliothèque. */
function refresh(onGameUpdated: (game: Game) => void, onProgress: (progress: InstallProgress) => void): void {
  const steamGames = getGames().filter((g) => g.steamAppId)
  if (steamGames.length === 0) return
  const steamFolder = findSteamFolder()
  if (!steamFolder) return

  const manifests = readManifests(steamFolder)
  const progress: InstallProgress = {}
  let appInfo: ReturnType<typeof readAppInfo> | null = null // lu seulement si besoin

  for (const game of steamGames) {
    const m = manifests.get(game.steamAppId!)
    const patch: Partial<Game> = {}

    if (m?.installed) {
      // Installé : dossier et taille exacte sur le disque
      if (game.installed === false) {
        patch.installed = true
        console.log(`[steam] "${game.name}" est installé`)
      }
      if (game.gameFolder !== m.installDir) patch.gameFolder = m.installDir
      if (m.sizeOnDisk > 0 && (game.sizeBytes !== m.sizeOnDisk || game.sizeIsEstimate)) {
        patch.sizeBytes = m.sizeOnDisk
        patch.sizeIsEstimate = false
      }
    } else {
      // Pas installé (ou téléchargement en cours) : taille estimée à installer
      if (game.installed !== false) {
        patch.installed = false
        console.log(`[steam] "${game.name}" n'est pas installé`)
      }
      if (!game.sizeIsEstimate || !game.sizeBytes) {
        appInfo ??= readAppInfo(steamFolder)
        const estimate = appInfo.get(game.steamAppId!)?.installBytes || null
        if (estimate !== (game.sizeBytes ?? null) || !game.sizeIsEstimate) {
          patch.sizeBytes = estimate
          patch.sizeIsEstimate = true
        }
      }
      if (m && m.bytesToDownload > 0) {
        progress[game.id] = Math.min(100, Math.floor((m.bytesDownloaded / m.bytesToDownload) * 100))
      }
    }

    if (Object.keys(patch).length > 0) onGameUpdated(updateGame(game.id, patch))
  }

  // On ne prévient l'interface que si l'avancement a changé
  const text = JSON.stringify(progress)
  if (text !== lastProgress) {
    lastProgress = text
    onProgress(progress)
  }
}
