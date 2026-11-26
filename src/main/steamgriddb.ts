// Client minimal pour l'API SteamGridDB v2 (https://www.steamgriddb.com/api/v2).
// Documentation : https://www.steamgriddb.com/api/v2
//
// Chaque utilisateur a SA clé API (gratuite) : steamgriddb.com → Préférences → API.
// La clé est lue depuis les paramètres locaux (settings.ts), jamais depuis le code.

import { net } from 'electron'
import type { AutoCoverResult, Game, SgdbGame, SgdbGrid, SgdbSearchResult } from '@shared/types'
import { getSettings } from './settings'
import { downloadCover, coverPath } from './covers'
import { getGame, updateGame } from './library'
import { fallbackNames, isGenericName, isSameName, nameVariants, rankBySimilarity } from './gameNames'
import { readExeInfo } from './exeInfo'
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

/**
 * Recherche "intelligente" : si le nom tapé ne donne rien (faute de frappe, nom de fichier,
 * abréviation, mention d'édition...), on essaie des orthographes corrigées une par une
 * (voir gameNames.ts) jusqu'à trouver des résultats, triés du plus ressemblant au moins ressemblant.
 */
export async function smartSearch(term: string): Promise<SgdbSearchResult> {
  const direct = await searchGames(term)
  if (direct.length > 0) return { results: direct, correctedTerm: null }

  for (const variant of nameVariants(term)) {
    const results = await searchGames(variant)
    if (results.length > 0) return { results: rankBySimilarity(term, results), correctedTerm: variant }
  }
  return { results: [], correctedTerm: null }
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
 * Cherche le jeu correspondant à UN nom.
 * `match` = le jeu trouvé avec certitude (même nom à la mise en forme près, ou un seul résultat
 * pour le nom exact), sinon null ; `results` = tous les jeux trouvés.
 */
async function findMatch(name: string): Promise<{ match: SgdbGame | null; results: SgdbGame[] }> {
  const { results, correctedTerm } = await smartSearch(name)
  const exact = results.filter((r) => isSameName(r.name, name))
  // Un seul résultat ne suffit que si le nom n'a pas été corrigé (sinon on laisse l'utilisateur vérifier)
  const match = exact.length === 1 ? exact[0] : !correctedTerm && results.length === 1 ? results[0] : null
  return { match, results }
}

/**
 * Recherche automatique de jaquette, lancée juste après l'ajout d'un jeu :
 *  1. on lit la carte d'identité du .exe (nom du produit, éditeur) et on garde l'éditeur ;
 *  2. on cherche avec le nom du jeu, SAUF s'il ne veut rien dire ("launcher", "game"...) ;
 *  3. si ce nom est introuvable, on essaie les autres noms possibles : nom du produit écrit
 *     dans le .exe, puis nom du dossier (voir fallbackNames dans gameNames.ts) ;
 *  4. dès qu'un jeu est trouvé avec certitude → on applique sa première jaquette et on renomme
 *     le jeu avec son nom officiel ("launcher" devient "The Last of Us Part I") ;
 *  5. sinon, plusieurs résultats possibles → on renvoie la liste, l'interface demande à l'utilisateur ;
 *     aucun résultat / pas de clé → la boîte générique reste affichée.
 */
export async function autoCover(gameId: string): Promise<AutoCoverResult> {
  const game = getGame(gameId)
  if (!game) return { status: 'error', message: 'Jeu introuvable.' }

  // L'éditeur servira plus tard (fiche d'infos du jeu). Les jeux ajoutés avant cette version ne l'ont pas encore.
  const info = readExeInfo(game.exePath)
  if (info.publisher && !game.publisher) updateGame(gameId, { publisher: info.publisher })

  if (!getSettings().steamGridDbApiKey.trim()) return { status: 'no-key' }

  const others = fallbackNames(game.exePath, info).filter((name) => !isSameName(name, game.name))
  const candidates = isGenericName(game.name) ? others : [game.name, ...others]

  try {
    let firstResults: SgdbGame[] = []
    for (const name of candidates) {
      const { match, results } = await findMatch(name)
      if (!match) {
        if (firstResults.length === 0) firstResults = results
        continue
      }

      const grids = await getGrids(match.id)
      if (grids.length === 0) continue
      let updated = await setCover(gameId, grids[0].url, match.id)
      // Nom officiel : "HorizonForbiddenWest" devient "Horizon Forbidden West",
      // et un nom trouvé autrement ("launcher" → "The Last of Us Part I") remplace l'ancien.
      const foundElsewhere = name !== game.name
      if (match.name !== game.name && (foundElsewhere || isSameName(match.name, game.name))) {
        updated = updateGame(gameId, { name: match.name })
      }
      return { status: 'applied', game: updated }
    }
    return firstResults.length > 0 ? { status: 'multiple', results: firstResults } : { status: 'none' }
  } catch (error) {
    return { status: 'error', message: (error as Error).message }
  }
}
