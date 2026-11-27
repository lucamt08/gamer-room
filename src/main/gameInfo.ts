// La fiche d'un jeu pour le panneau de détails (GameDetails.tsx), au même format pour tous les jeux.
//
// On cherche dans cet ordre, et on s'arrête dès qu'on trouve :
//  1. jeu Steam            → sa page Steam + ses succès (lus sur le PC, voir steamAchievements.ts) ;
//  2. autre jeu (Epic, GOG, Battle.net, Riot, local) → sa page Steam trouvée par son NOM, sans les succès
//     (ex. Stray installé sans Steam : la page Steam de Stray) ;
//  3. jeu absent de Steam  → résumé Wikipédia + infos Wikidata (ex. VALORANT, Fortnite), voir wikiInfo.ts.
// Les infos du PC (origine, temps de jeu, taille…) sont affichées par l'interface dans tous les cas :
// une fiche n'est donc jamais complètement vide, même hors ligne ou pour un petit jeu inconnu.

import type { Game, GameInfo } from '@shared/types'
import { readSteamAchievements } from './steamAchievements'
import { findSteamAppIdByName, getSteamSheet } from './steamStore'
import { getWikiSheet } from './wikiInfo'

/** La fiche et les succès d'un jeu. Ne lance jamais d'erreur. */
export async function getGameInfo(game: Game): Promise<GameInfo> {
  // 1. Jeu Steam : page Steam + succès
  if (game.steamAppId) {
    const achievements = readSteamAchievements(game.steamAppId)
    const { sheet, percents } = await getSteamSheet(game.steamAppId)
    return {
      // (jeu retiré du magasin Steam : on tente Wikipédia)
      sheet: sheet ?? (await getWikiSheet(game.name)),
      achievements: achievements?.map((a) => ({ ...a, globalPercent: percents[a.id] ?? null })) ?? null
    }
  }

  // 2. Autre jeu : sa page Steam, si le jeu existe sur Steam sous le même nom
  const appId = await findSteamAppIdByName(game.name)
  if (appId) {
    const { sheet } = await getSteamSheet(appId)
    if (sheet) return { sheet, achievements: null }
  }

  // 3. Pas sur Steam : Wikipédia + Wikidata
  return { sheet: await getWikiSheet(game.name), achievements: null }
}
