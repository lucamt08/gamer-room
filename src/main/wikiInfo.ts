// Fiche d'un jeu depuis Wikipédia et Wikidata, pour les jeux qui ne sont pas sur Steam
// (VALORANT, League of Legends, Fortnite, Alan Wake 2…). Gratuit, sans clé ni compte.
//
// Comment ça marche, en 3 demandes (on envoie seulement le NOM du jeu) :
//  1. Wikidata (la base de données derrière Wikipédia) : on cherche le nom, et on garde le résultat qui est
//     un JEU VIDÉO (propriété P31 « nature » = Q7889 « jeu vidéo ») avec exactement ce nom (en français ou en
//     anglais). Ex. "Valorant" → Q86919275 (et pas « Valorant Champions Tour », la compétition).
//  2. On lit ses infos rangées : développeur (P178), éditeur (P123), date de sortie (P577), genres (P136),
//     modes de jeu (P404), plateformes (P400), série (P179), note Metacritic (P444 avec « par » = Metacritic).
//     Ces infos renvoient à d'autres éléments (Q1060165 = Riot Games…) : on demande leurs noms en français.
//  3. Wikipédia : le premier paragraphe de l'article du jeu, en français (en anglais s'il n'existe pas en français).
//
// Résultat gardé 7 jours dans userData\game-info (voir httpJson.ts).

import type { GameSheet } from '@shared/types'
import { gameKey } from '@shared/duplicates'
import { getJson, readCache, safeFileName, writeCache } from './httpJson'

const KEEP_FOR = 7 * 24 * 60 * 60 * 1000 // 7 jours
const WIKIDATA = 'https://www.wikidata.org/w/api.php'
const VIDEO_GAME = 'Q7889'
const METACRITIC = 'Q21039459'
/** Longueur maximale du résumé (environ la taille d'une description Steam). */
const MAX_DESCRIPTION = 450

type Snak = { datavalue?: { value?: unknown } }
type Claim = { mainsnak?: Snak; qualifiers?: Record<string, Snak[]> }
interface Entity {
  id: string
  labels?: Record<string, { value: string }>
  aliases?: Record<string, { value: string }[]>
  claims?: Record<string, Claim[]>
  sitelinks?: Record<string, { title: string }>
}

/** Les éléments Wikidata demandés (par lots de 50, la limite de Wikidata). */
async function getEntities(ids: string[], props: string): Promise<Map<string, Entity>> {
  const entities = new Map<string, Entity>()
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    const result = (await getJson(
      `${WIKIDATA}?action=wbgetentities&ids=${batch.join('|')}&props=${props}&languages=fr|en|mul&format=json`
    )) as { entities?: Record<string, Entity> } | null
    for (const entity of Object.values(result?.entities ?? {})) entities.set(entity.id, entity)
  }
  return entities
}

/**
 * Nom d'un élément en français, sinon en anglais, sinon son nom « toutes langues » (mul) :
 * Wikidata range désormais beaucoup de noms identiques partout (ex. "Alan Wake 2") dans « mul ».
 */
function label(entity: Entity | undefined): string {
  return entity?.labels?.fr?.value ?? entity?.labels?.en?.value ?? entity?.labels?.mul?.value ?? ''
}

/** Numéros des éléments cités par une propriété (ex. P178 → ["Q1060165"]). */
function itemIds(entity: Entity, property: string): string[] {
  return (entity.claims?.[property] ?? [])
    .map((c) => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id)
    .filter((id): id is string => !!id)
}

/** Ce jeu Wikidata porte-t-il exactement ce nom (français, anglais, « toutes langues », ou un autre nom connu) ? */
function hasName(entity: Entity, key: string): boolean {
  const languages = ['fr', 'en', 'mul']
  const names = [
    ...languages.map((language) => entity.labels?.[language]?.value),
    ...languages.flatMap((language) => (entity.aliases?.[language] ?? []).map((a) => a.value))
  ]
  return names.some((name) => name && gameKey(name) === key)
}

/** Date de sortie la plus ancienne, au même format que Steam : "2 juin 2020", "juin 2020" ou "2020". */
function releaseDate(entity: Entity): string {
  const dates = (entity.claims?.['P577'] ?? [])
    .map((c) => c.mainsnak?.datavalue?.value as { time?: string; precision?: number } | undefined)
    .filter((v): v is { time: string; precision?: number } => typeof v?.time === 'string')
    .sort((a, b) => a.time.localeCompare(b.time))
  const first = dates[0]
  if (!first) return ''
  const match = /^\+?(\d{4})-(\d{2})-(\d{2})/.exec(first.time)
  if (!match) return ''
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, Math.max(0, month - 1), Math.max(1, day)))
  const precision = first.precision ?? 11 // 11 = jour, 10 = mois, 9 = année
  if (precision >= 11 && day > 0) return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (precision === 10 && month > 0) return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return String(year)
}

/** Note Metacritic ("81/100" par Metacritic), ou null. */
function metacritic(entity: Entity): number | null {
  for (const claim of entity.claims?.['P444'] ?? []) {
    const by = (claim.qualifiers?.['P447']?.[0]?.datavalue?.value as { id?: string } | undefined)?.id
    const value = claim.mainsnak?.datavalue?.value
    const match = typeof value === 'string' ? /^(\d{1,3})\s*\/\s*100$/.exec(value) : null
    if (by === METACRITIC && match) return Number(match[1])
  }
  return null
}

/** Coupe le résumé proprement à la fin d'une phrase, vers MAX_DESCRIPTION caractères. */
function shorten(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= MAX_DESCRIPTION) return clean
  const cut = clean.slice(0, MAX_DESCRIPTION)
  const end = cut.lastIndexOf('. ')
  return end > 120 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

/** Premier paragraphe de l'article Wikipédia (français, sinon anglais), et son adresse. */
async function wikipediaSummary(entity: Entity): Promise<{ text: string; url: string | null }> {
  for (const language of ['fr', 'en']) {
    const title = entity.sitelinks?.[`${language}wiki`]?.title
    if (!title) continue
    const summary = (await getJson(
      `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`
    )) as { extract?: string; content_urls?: { desktop?: { page?: string } } } | null
    if (summary?.extract) return { text: shorten(summary.extract), url: summary.content_urls?.desktop?.page ?? null }
  }
  return { text: '', url: null }
}

/** Cherche le jeu dans Wikidata et construit sa fiche. null = introuvable, undefined = pas de réponse (hors ligne). */
async function fetchSheet(name: string): Promise<GameSheet | null | undefined> {
  const key = gameKey(name)
  // 1. Recherche par le nom (en français ; Wikidata cherche aussi les noms anglais)
  const search = (await getJson(
    `${WIKIDATA}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=fr&uselang=fr&type=item&limit=10&format=json`
  )) as { search?: { id: string }[] } | null
  if (!search) return undefined
  const ids = (search.search ?? []).map((s) => s.id)
  if (ids.length === 0) return null

  // 2. Le premier résultat qui est un jeu vidéo portant exactement ce nom
  const candidates = await getEntities(ids, 'labels|aliases|claims|sitelinks')
  const game = ids.map((id) => candidates.get(id)).find((e): e is Entity => !!e && itemIds(e, 'P31').includes(VIDEO_GAME) && hasName(e, key))
  if (!game) return null

  // Noms en français des éléments cités (développeur, genres…)
  const properties = { developers: 'P178', publishers: 'P123', genres: 'P136', modes: 'P404', platforms: 'P400', series: 'P179' }
  const linked = [...new Set(Object.values(properties).flatMap((p) => itemIds(game, p)))]
  const labels = await getEntities(linked, 'labels')
  const names = (property: string): string[] => [
    ...new Set(itemIds(game, property).map((id) => label(labels.get(id))).filter(Boolean))
  ]
  // Première lettre en majuscule ("jeu de tir" → "Jeu de tir"), comme les genres de Steam
  const capitalized = (list: string[]): string[] => list.map((text) => text.charAt(0).toUpperCase() + text.slice(1))

  // 3. Résumé Wikipédia
  const summary = await wikipediaSummary(game)

  return {
    source: 'wikipedia',
    sourceUrl: summary.url ?? `https://www.wikidata.org/wiki/${game.id}`,
    shortDescription: summary.text,
    developers: names(properties.developers),
    publishers: names(properties.publishers),
    releaseDate: releaseDate(game),
    genres: capitalized(names(properties.genres)),
    modes: capitalized(names(properties.modes)),
    platforms: names(properties.platforms),
    series: names(properties.series)[0] ?? null,
    metacritic: metacritic(game),
    controllerSupport: null,
    recommendations: null,
    screenshots: [],
    background: null
  }
}

/**
 * Fiche Wikipédia / Wikidata d'un jeu, par son nom (depuis le cache s'il a moins de 7 jours).
 * Ne lance jamais d'erreur : renvoie null si le jeu est introuvable ou sans Internet (et sans cache).
 */
export async function getWikiSheet(name: string): Promise<GameSheet | null> {
  const key = gameKey(name)
  if (!key) return null
  const cacheName = `wiki-${safeFileName(key)}`
  const cached = readCache<{ fetchedAt: number; sheet: GameSheet | null }>(cacheName)
  if (cached && Date.now() - cached.fetchedAt < KEEP_FOR) return cached.sheet

  try {
    const sheet = await fetchSheet(name)
    if (sheet === undefined) return cached?.sheet ?? null // pas d'Internet : dernière fiche connue
    writeCache(cacheName, { fetchedAt: Date.now(), sheet })
    return sheet
  } catch (error) {
    console.warn(`[fiche] Wikipédia : erreur pour "${name}"`, error)
    return cached?.sheet ?? null
  }
}
