// Ce que le hub apprend en lançant un jeu.
//
// Au premier lancement d'un jeu, on voit QUEL programme ouvre vraiment la fenêtre du jeu.
// Si ce n'est pas le .exe ajouté (launcher, relais, Steam...), on le retient dans `realExePath`.
// Si le jeu porte encore le nom de son launcher ("Longshot", "REDprelauncher", "b1"...),
// on cherche son vrai nom et sa jaquette (voir autoCover dans steamgriddb.ts).

import type { Game } from '@shared/types'
import { getGame, updateGame } from './library'
import { readExeInfo } from './exeInfo'
import { removeRunAsAdmin } from './compatFlags'
import { autoCover, nameComesFromLauncher } from './steamgriddb'

/** Deux chemins Windows désignent-ils le même fichier ? (Windows ne fait pas la différence majuscules/minuscules) */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

/** Cherche le vrai nom + la jaquette si le jeu porte le nom de son launcher. Renvoie le jeu à jour. */
export async function fixNameIfFromLauncher(gameId: string): Promise<Game | null> {
  const game = getGame(gameId)
  if (!game || !nameComesFromLauncher(game)) return null
  const result = await autoCover(gameId)
  return result.status === 'applied' ? result.game : null
}

/**
 * Appelé quand la fenêtre du jeu est trouvée.
 * `windowExePath` = chemin du programme qui a ouvert cette fenêtre.
 * Renvoie le jeu à jour si on a appris quelque chose, sinon null.
 */
export async function learnFromGameWindow(gameId: string, windowExePath: string | null): Promise<Game | null> {
  const game = getGame(gameId)
  if (!game || !windowExePath) return null
  if (samePath(windowExePath, game.exePath) || samePath(windowExePath, game.realExePath)) return null

  console.log(`[launcher] Vrai .exe du jeu appris : ${windowExePath}`)
  let updated = updateGame(gameId, {
    realExePath: windowExePath,
    // Un "jeu" qui fait ouvrir sa fenêtre par un autre programme est en fait un relais
    launchKind: !game.launchKind || game.launchKind === 'game' ? 'relay' : game.launchKind
  })
  // Jeu Steam ou relais : on découvre seulement maintenant son vrai .exe → on décoche
  // « Exécuter en tant qu'administrateur » pour que les prochains lancements se passent bien
  removeRunAsAdmin(windowExePath)
  const publisher = readExeInfo(windowExePath).publisher
  if (publisher && !updated.publisher) updated = updateGame(gameId, { publisher })

  return (await fixNameIfFromLauncher(gameId)) ?? updated
}
