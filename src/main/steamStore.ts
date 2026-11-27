// Fiche d'un jeu depuis sa page Steam (description, développeur, genres…), rareté de ses succès,
// et recherche de la page Steam d'un jeu qui n'a pas été ajouté depuis Steam (par son nom).
//
// Adresses publiques de Steam (sans clé, sans compte : on envoie seulement le numéro ou le nom du jeu) :
//  - https://store.steampowered.com/api/appdetails?appids=<jeu>&l=french
//      → la fiche du magasin, en français ;
//  - https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=<jeu>
//      → pour chaque succès, le pourcentage des joueurs qui l'ont débloqué ;
//  - https://store.steampowered.com/api/storesearch/?term=<nom>&l=french
//      → recherche dans le magasin (pour les jeux Epic, GOG, locaux…).
//
// Les réponses sont gardées 7 jours dans userData\game-info : la fiche s'affiche tout de suite
// les fois suivantes, et Steam n'est pas sollicité à chaque clic. Sans Internet, on réutilise
// la dernière fiche connue, même plus vieille.

import { app } from 'electron'
import type { GameSheet } from '@shared/types'
import { gameKey } from '@shared/duplicates'
import { getJson, readCache, safeFileName, writeCache } from './httpJson'

const KEEP_FOR = 7 * 24 * 60 * 60 * 1000 // 7 jours

/** Ce qu'on garde en cache pour un jeu Steam. */
interface CachedStore {
  fetchedAt: number
  sheet: GameSheet | null
  /** Identifiant du succès → pourcentage des joueurs qui l'ont. */
  percents: Record<string, number>
}

/** Texte de la description : Steam y met parfois du HTML (<b>, &quot;…) qu'on enlève. */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
}

/**
 * Catégories Steam qui décrivent les MODES de jeu (numéros fixes chez Steam), dans l'ordre d'affichage :
 * 2 = Solo, 1 = Multijoueur, 49 = JcJ, 36 = JcJ en ligne, 9 = Coopération, 38 = Coopération en ligne,
 * 24 = Écran partagé, 39 = Coop. en écran partagé.
 */
const MODE_CATEGORIES = [2, 1, 49, 36, 9, 38, 24, 39]

/** Transforme la réponse de appdetails en fiche. */
function toSheet(appId: number, data: Record<string, unknown>): GameSheet {
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
  const descriptions = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((v: { description?: unknown }) => v?.description).filter((d): d is string => typeof d === 'string') : []
  const categories = Array.isArray(data['categories']) ? (data['categories'] as { id?: unknown; description?: unknown }[]) : []
  const controller = data['controller_support']
  return {
    source: 'steam',
    sourceUrl: `https://store.steampowered.com/app/${appId}`,
    shortDescription: plainText(typeof data['short_description'] === 'string' ? data['short_description'] : ''),
    developers: list(data['developers']),
    publishers: list(data['publishers']),
    releaseDate: String((data['release_date'] as { date?: unknown } | undefined)?.date ?? ''),
    genres: descriptions(data['genres']),
    modes: MODE_CATEGORIES.map((id) => categories.find((c) => Number(c.id) === id)?.description).filter(
      (d): d is string => typeof d === 'string'
    ),
    platforms: [],
    series: null,
    metacritic: Number((data['metacritic'] as { score?: unknown } | undefined)?.score) || null,
    controllerSupport: controller === 'full' || controller === 'partial' ? controller : null,
    recommendations: Number((data['recommendations'] as { total?: unknown } | undefined)?.total) || null,
    screenshots: Array.isArray(data['screenshots'])
      ? (data['screenshots'] as { path_thumbnail?: unknown }[])
          .map((s) => s.path_thumbnail)
          .filter((p): p is string => typeof p === 'string')
          .slice(0, 6)
      : [],
    background: typeof data['background_raw'] === 'string' ? data['background_raw'] : typeof data['background'] === 'string' ? data['background'] : null
  }
}

/**
 * Fiche Steam + rareté des succès d'un jeu (depuis le cache s'il a moins de 7 jours).
 * Ne lance jamais d'erreur : sans Internet et sans cache, renvoie une fiche vide (null).
 */
export async function getSteamSheet(appId: number): Promise<{ sheet: GameSheet | null; percents: Record<string, number> }> {
  const cacheName = `steam-${appId}`
  const cached = readCache<CachedStore>(cacheName)
  if (cached && Date.now() - cached.fetchedAt < KEEP_FOR) return cached

  const [details, percents] = await Promise.all([
    getJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=french`),
    getJson(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}&format=json`)
  ])
  const entry = (details as Record<string, { success?: boolean; data?: Record<string, unknown> }> | null)?.[String(appId)]
  const list = (percents as { achievementpercentages?: { achievements?: { name: string; percent: unknown }[] } } | null)
    ?.achievementpercentages?.achievements

  // Pas de réponse du tout (pas d'Internet…) : on garde l'ancienne fiche si on en a une
  if (!entry && !list) return cached ?? { sheet: null, percents: {} }

  const result: CachedStore = {
    fetchedAt: Date.now(),
    sheet: entry?.success && entry.data ? toSheet(appId, entry.data) : (cached?.sheet ?? null),
    percents: list ? Object.fromEntries(list.map((a) => [a.name, Number(a.percent) || 0])) : (cached?.percents ?? {})
  }
  writeCache(cacheName, result)
  return result
}

/**
 * Numéro Steam d'un jeu ajouté d'ailleurs (Epic, GOG, local…), cherché par son NOM dans le magasin Steam.
 * On n'accepte que le même nom (sans tenir compte des majuscules, accents, ™…, voir gameKey) :
 * mieux vaut pas de fiche Steam qu'une fiche d'un autre jeu.
 * Renvoie null si le jeu n'est pas sur Steam. `undefined` = pas de réponse (pas d'Internet) : on réessaiera.
 */
export async function findSteamAppIdByName(name: string): Promise<number | null | undefined> {
  const key = gameKey(name)
  if (!key) return null
  const cacheName = `steam-search-${safeFileName(key)}`
  const cached = readCache<{ checkedAt: number; appId: number | null }>(cacheName)
  if (cached && Date.now() - cached.checkedAt < KEEP_FOR) return cached.appId

  // Steam ne répond à la recherche qu'avec un pays (celui de Windows, ex. "FR" ; "US" si inconnu)
  const country = app.getLocaleCountryCode() || 'US'
  const result = (await getJson(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=french&cc=${country}`
  )) as {
    items?: { id?: unknown; name?: unknown; type?: unknown }[]
  } | null
  if (!result) return cached ? cached.appId : undefined
  const match = result.items?.find((item) => item.type === 'app' && typeof item.name === 'string' && gameKey(item.name) === key)
  const appId = match && Number(match.id) > 0 ? Number(match.id) : null
  writeCache(cacheName, { checkedAt: Date.now(), appId })
  return appId
}
