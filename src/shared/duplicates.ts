// Doublons : le même jeu présent plusieurs fois dans Gamer Room (ex. Rocket League sur Steam ET sur Epic,
// ou Stray installé sans launcher ET dans la bibliothèque Steam).
//
// On ne supprime jamais rien : chaque exemplaire reste dans library.json (son temps de jeu, sa jaquette…).
// Mais l'étagère n'affiche qu'UNE boîte par jeu : le meilleur exemplaire (voir bestCopyFirst).
// Les autres sont indiqués sous le nom du jeu (« Aussi sur Epic Games »).
// Les imports (« + Jeux Steam », « + Jeux du PC ») ne proposent plus un jeu déjà présent (voir isAlreadyInLibrary).
//
// Deux jeux sont « le même » quand leur nom est le même, sans tenir compte des majuscules, accents,
// symboles ™ ® et de la ponctuation : "VALORANT" = "Valorant", "Batman™: Arkham Knight" = "Batman Arkham Knight".

import type { Game, GameSource } from './types'

/** Nom simplifié qui sert à reconnaître le même jeu : "Batman™: Arkham Knight" → "batman arkham knight". */
export function gameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** D'où vient un jeu : 'steam', un magasin, ou 'pc' (jeu local, sans launcher). */
export function gameOrigin(game: Game): 'steam' | GameSource {
  if (game.steamAppId || game.launchKind === 'steam') return 'steam'
  return game.source ?? 'pc'
}

/** Nom lisible de l'origine d'un jeu, pour l'interface. */
export function originLabel(game: Game): string {
  switch (gameOrigin(game)) {
    case 'steam':
      return 'Steam'
    case 'epic':
      return 'Epic Games'
    case 'battlenet':
      return 'Battle.net'
    case 'gog':
      return 'GOG'
    case 'riot':
      return 'Riot Games'
    default:
      return 'Jeu local (sans launcher)'
  }
}

/** Ordre de préférence des origines quand un jeu est présent plusieurs fois (et installé partout ou nulle part). */
const ORIGIN_ORDER: ('steam' | GameSource)[] = ['steam', 'epic', 'battlenet', 'gog', 'riot', 'pc']

/** Trie pour avoir le meilleur exemplaire en premier : installé d'abord, puis Steam, Epic, Battle.net, GOG, Riot, local. */
function bestCopyFirst(a: Game, b: Game): number {
  const installed = Number(b.installed !== false) - Number(a.installed !== false)
  if (installed !== 0) return installed
  return ORIGIN_ORDER.indexOf(gameOrigin(a)) - ORIGIN_ORDER.indexOf(gameOrigin(b))
}

/**
 * Regroupe les doublons.
 *  - `visible` : un jeu par groupe (le meilleur exemplaire), à la place du premier exemplaire ajouté
 *    (l'ordre de l'étagère ne bouge pas quand un autre exemplaire devient le meilleur) ;
 *  - `otherCopies` : id du jeu affiché → ses autres exemplaires (cachés).
 */
export function groupDuplicates(games: Game[]): { visible: Game[]; otherCopies: Map<string, Game[]> } {
  const groups = new Map<string, Game[]>()
  for (const game of games) {
    const key = gameKey(game.name) || game.id // nom vide : jamais regroupé
    const group = groups.get(key)
    if (group) group.push(game)
    else groups.set(key, [game])
  }
  const visible: Game[] = []
  const otherCopies = new Map<string, Game[]>()
  for (const group of groups.values()) {
    const [best, ...others] = [...group].sort(bestCopyFirst)
    visible.push(best)
    if (others.length > 0) otherCopies.set(best.id, others)
  }
  return { visible, otherCopies }
}

/**
 * Un jeu trouvé par un import est-il déjà dans Gamer Room (sous le même nom, n'importe quelle origine) ?
 * Exception : un exemplaire INSTALLÉ reste proposé quand ceux de Gamer Room ne sont pas installés
 * (ex. Stray installé hors Steam, alors que Gamer Room n'a que Stray « non installé » de Steam).
 */
export function isAlreadyInLibrary(name: string, installed: boolean, library: Game[]): boolean {
  const key = gameKey(name)
  if (!key) return false
  return library.some((g) => gameKey(g.name) === key && (g.installed !== false || !installed))
}
