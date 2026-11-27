// Jeux GOG installés.
//
// L'installateur GOG (avec ou sans GOG Galaxy) note chaque jeu dans le registre Windows :
//   HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<gameID>
//     gameName = nom, path = dossier, exe = .exe du jeu, launchParam = arguments, workingDir = dossier de travail
// Les jeux GOG sont sans DRM : on les lance directement par leur .exe (pas besoin de GOG Galaxy).

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { normalize } from 'node:path'
import type { DetectedGame } from '@shared/types'

/** Ce qu'il faut pour ajouter un jeu GOG. */
export interface GogGame extends DetectedGame {
  gameId: string
  args: string
  workingDir: string
}

/** Valeurs texte de chaque sous-clé de registre : clé → { nom de la valeur → texte }. */
function readRegistryTree(key: string): Map<string, Record<string, string>> {
  const tree = new Map<string, Record<string, string>>()
  let output: string
  try {
    output = execFileSync('reg', ['query', key, '/s'], { encoding: 'utf8', windowsHide: true })
  } catch {
    return tree // clé absente : GOG jamais utilisé
  }
  let current: Record<string, string> | null = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) {
      current = {}
      tree.set(line.trim(), current)
      continue
    }
    const match = /^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/.exec(line)
    if (match && current) current[match[1].toLowerCase()] = match[2].trim()
  }
  return tree
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
