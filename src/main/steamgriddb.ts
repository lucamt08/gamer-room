// Client minimal pour l'API SteamGridDB v2 (https://www.steamgriddb.com/api/v2).
// Documentation : https://www.steamgriddb.com/api/v2
//
// Chaque utilisateur a SA clé API (gratuite) : steamgriddb.com → Préférences → API.
// La clé est lue depuis les paramètres locaux (settings.ts), jamais depuis le code.

import { net } from 'electron'
import type { AutoCoverResult, Game, SgdbGame, SgdbGrid, SgdbSearchResult } from '@shared/types'
import { getSettings } from './settings'
import { downloadCover, coverPath } from './covers'
import { getGame, guessName, updateGame } from './library'
import {
  fallbackNames,
  isGenericName,
  isSameName,
  nameVariants,
  normalizeName,
  pickBest,
  rankBySimilarity
} from './gameNames'
import { readExeInfo } from './exeInfo'
import { detectLaunchKind } from './launcherDetect'
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

/** Cherche un jeu SteamGridDB par son numéro Steam. Renvoie null s'il est inconnu. */
async function findBySteamId(appId: number): Promise<SgdbGame | null> {
  try {
    const g = await call<{ id: number; name: string; release_date?: number }>(`/games/steam/${appId}`)
    return { id: g.id, name: g.name, year: g.release_date ? new Date(g.release_date * 1000).getFullYear() : null }
  } catch {
    return null
  }
}

/**
 * Noms possibles du VRAI jeu quand on passe par un launcher ou un relais :
 * indices trouvés dans la config du launcher (Longshot), puis carte d'identité et dossier du vrai .exe.
 */
function realGameNames(game: Game): string[] {
  if (game.launchKind !== 'launcher' && game.launchKind !== 'relay') return []
  const hints = detectLaunchKind(game.exePath).nameHints.map(normalizeName)
  const fromRealExe = game.realExePath ? fallbackNames(game.realExePath, readExeInfo(game.realExePath)) : []
  return [...hints, ...fromRealExe].filter((name) => name && !isGenericName(name))
}

/**
 * Le nom actuel du jeu est-il celui du launcher plutôt que celui du jeu ?
 * Ex. "Longshot" (LongshotLauncher.exe), "REDprelauncher", "b1", "launcher".
 */
export function nameComesFromLauncher(game: Game, info = readExeInfo(game.exePath)): boolean {
  if (isGenericName(game.name)) return true
  if (game.launchKind !== 'launcher' && game.launchKind !== 'relay') return false
  return isSameName(game.name, guessName(game.exePath)) || (!!info.productName && isSameName(game.name, info.productName))
}

/**
 * Cherche le jeu correspondant à UN nom.
 * `match` = le jeu trouvé avec certitude (même nom à la mise en forme près, ou un seul résultat
 * pour le nom exact), sinon null ; `results` = tous les jeux trouvés.
 */
async function findMatch(name: string): Promise<{ match: SgdbGame | null; results: SgdbGame[] }> {
  const { results, correctedTerm } = await smartSearch(name)
  const exact = results.filter((r) => isSameName(r.name, name))
  // 1. un seul jeu au nom identique ; 2. un seul résultat pour le nom exact ;
  // 3. sinon, le plus ressemblant si c'est clair (voir pickBest dans gameNames.ts)
  const match =
    exact.length === 1 ? exact[0] : !correctedTerm && results.length === 1 ? results[0] : pickBest(name, results)
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
 * Cas particuliers :
 *  - jeu Steam : on demande directement le jeu par son numéro Steam (résultat exact) ;
 *  - launcher ou relais : on cherche d'abord avec les noms du VRAI jeu (son .exe, la config du launcher),
 *    surtout si le nom actuel est celui du launcher ("Longshot" → "The Legend of Zelda: Ocarina of Time").
 */
export async function autoCover(gameId: string): Promise<AutoCoverResult> {
  const game = getGame(gameId)
  if (!game) return { status: 'error', message: 'Jeu introuvable.' }

  // L'éditeur servira plus tard (fiche d'infos du jeu). Pour un launcher, on préfère celui du vrai jeu.
  const info = readExeInfo(game.exePath)
  const publisher = (game.realExePath && readExeInfo(game.realExePath).publisher) || info.publisher
  if (publisher && !game.publisher) updateGame(gameId, { publisher })

  if (!getSettings().steamGridDbApiKey.trim()) return { status: 'no-key' }

  try {
    // Jeu Steam : SteamGridDB le connaît par son numéro Steam
    if (game.steamAppId) {
      const steamMatch = await findBySteamId(game.steamAppId)
      const grids = steamMatch ? await getGrids(steamMatch.id) : []
      if (steamMatch && grids.length > 0) {
        return { status: 'applied', game: await setCover(gameId, grids[0].url, steamMatch.id) }
      }
    }

    const real = realGameNames(game)
    const own = fallbackNames(game.exePath, info)
    // Pour un launcher, son propre nom ("REDlauncher", "Longshot Launcher") n'aide pas : on garde les noms du vrai jeu
    const others = (game.launchKind === 'launcher' && real.length > 0 ? real : [...real, ...own]).filter(
      (name, index, list) => !isSameName(name, game.name) && list.findIndex((n) => isSameName(n, name)) === index
    )
    const candidates = nameComesFromLauncher(game, info) ? others : [game.name, ...others]

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
