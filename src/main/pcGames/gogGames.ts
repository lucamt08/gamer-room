// Jeux GOG installés.
//
// L'installateur GOG (avec ou sans GOG Galaxy) note chaque jeu dans le registre Windows :
//   HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<gameID>
//     gameName = nom, path = dossier, exe = .exe du jeu, launchParam = arguments, workingDir = dossier de travail
// Les jeux GOG sont sans DRM : on les lance directement par leur .exe (pas besoin de GOG Galaxy).

import { existsSync } from 'node:fs'
import { normalize } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { readRegistryTree } from './registry'

/** Ce qu'il faut pour ajouter un jeu GOG. */
export interface GogGame extends DetectedGame {
  gameId: string
  args: string
  workingDir: string
}

/** Tous les jeux GOG installés (liste vide si aucun). */
export function listGogGames(): GogGame[] {
  const games: GogGame[] = []
  const tree = readRegistryTree('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games')
  for (const values of tree.values()) {
    const name = values['gamename']
    const exe = values['exe']
    const folder = values['path']
    const gameId = values['gameid']
    if (!name || !exe || !folder || !gameId || !existsSync(exe)) continue
    games.push({
      key: `gog:${gameId}`,
      source: 'gog',
      name: name.replace(/[®™©]/g, '').trim(),
      folder: normalize(folder),
      exePath: normalize(exe),
      sizeBytes: null,
      confidence: 'high',
      reasons: ['GOG'],
      gameId,
      args: values['launchparam'] ?? '',
      workingDir: values['workingdir'] || folder
    })
  }
  return games
}
