// Client minimal pour l'API SteamGridDB v2 (https://www.steamgriddb.com/api/v2).
// Documentation : https://www.steamgriddb.com/api/v2
//
// Chaque utilisateur a SA clé API (gratuite) : steamgriddb.com → Préférences → API.
// La clé est lue depuis les paramètres locaux (settings.ts), jamais depuis le code.

import { net } from 'electron'
import type { AutoCoverResult, Game, SgdbGame, SgdbGrid } from '@shared/types'
import { getSettings } from './settings'
import { downloadCover, coverPath } from './covers'
import { getGame, updateGame } from './library'
import { rmSync } from 'node:fs'

const API = 'https://www.steamgriddb.com/api/v2'

/** Appelle l'API avec la clé de l'utilisateur et renvoie le champ `data` de la réponse. */
async function call<T>(path: string): Promise<T> {
  const key = getSettings().steamGridDbApiKey.trim()
  if (!key) throw new Error('Aucune clé API SteamGridDB. Ajoute-la dans les Paramètres.')

  const response = await net.fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${key}` }
  })
  if (response.status === 401) throw new Error('Clé API SteamGridDB refusée (401). Vérifie-la dans les Paramètres.')
  if (!response.ok) throw new Error(`Erreur SteamGridDB (HTTP ${response.status})`)

  const body = (await response.json()) as { success: boolean; data: T; errors?: string[] }
  if (!body.success) throw new Error(body.errors?.join(', ') || 'Erreur SteamGridDB')
  return body.data
}

/** Recherche des jeux par nom (autocomplétion). */
export async function searchGames(term: string): Promise<SgdbGame[]> {
  if (!term.trim()) return []
  const data = await call<Array<{ id: number; name: string; release_date?: number }>>(
    `/search/autocomplete/${encodeURIComponent(term.trim())}`
  )
  return data.map((g) => ({
    id: g.id,
    name: g.name,
    year: g.release_date ? new Date(g.release_date * 1000).getFullYear() : null
  }))
}

/** Récupère les jaquettes au format boîte verticale (600x900) d'un jeu SteamGridDB. */
export async function getGrids(sgdbGameId: number): Promise<SgdbGrid[]> {
  const data = await call<Array<{ id: number; url: string; thumb: string; width: number; height: number }>>(
    `/grids/game/${sgdbGameId}?dimensions=600x900&types=static`
  )
  return data.map(({ id, url, thumb, width, height }) => ({ id, url, thumb, width, height }))
}

/** Télécharge une jaquette, la met en cache et l'associe au jeu. */
export async function setCover(gameId: string, gridUrl: string, sgdbGameId: number): Promise<Game> {
  const game = getGame(gameId)
  if (!game) throw new Error('Jeu introuvable.')
  const fileName = await downloadCover(gridUrl, gameId)
  // On supprime l'ancienne jaquette du cache
  if (game.coverFile) rmSync(coverPath(game.coverFile), { force: true })
  return updateGame(gameId, { coverFile: fileName, steamGridDbId: sgdbGameId })
}

/**
 * Recherche automatique après l'ajout d'un jeu :
 *  - 1 seul résultat → on applique directement sa première jaquette ;
 *  - plusieurs résultats → on renvoie la liste, l'interface demande à l'utilisateur ;
 *  - aucun résultat / pas de clé → la boîte générique reste affichée.
 */
export async function autoCover(gameId: string): Promise<AutoCoverResult> {
  const game = getGame(gameId)
  if (!game) return { status: 'error', message: 'Jeu introuvable.' }
  if (!getSettings().steamGridDbApiKey.trim()) return { status: 'no-key' }

  try {
    const results = await searchGames(game.name)
    if (results.length === 0) return { status: 'none' }

    // Correspondance exacte du nom (sans tenir compte des majuscules) = on considère que c'est le bon jeu
    const exact = results.filter((r) => r.name.toLowerCase() === game.name.toLowerCase())
    const match = results.length === 1 ? results[0] : exact.length === 1 ? exact[0] : null
    if (!match) return { status: 'multiple', results }

    const grids = await getGrids(match.id)
    if (grids.length === 0) return { status: 'none' }
    const updated = await setCover(gameId, grids[0].url, match.id)
    return { status: 'applied', game: updated }
  } catch (error) {
    return { status: 'error', message: (error as Error).message }
  }
}
