// Petites règles de lancement partagées entre le main et l'interface.
import type { Game } from './types'

/** Dossier d'un chemin Windows : "D:\jeux\Cyberpunk 2077\REDprelauncher.exe" → "D:\jeux\Cyberpunk 2077". */
function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')))
}

/** Peut-on lancer directement le vrai .exe du jeu, sans passer par son launcher ? */
export function canSkipLauncher(game: Game): boolean {
  return game.launchKind === 'launcher' && !!game.realExePath
}

/**
 * Faut-il sauter le launcher au lancement ?
 *  - si l'utilisateur a choisi (case dans « Modifier »), on respecte son choix ;
 *  - sinon, oui quand le vrai jeu est rangé dans le dossier du launcher (Cyberpunk : bin\x64\Cyberpunk2077.exe),
 *    non quand il est ailleurs (Longshot : le launcher prépare le jeu, mieux vaut le laisser faire).
 */
export function shouldSkipLauncher(game: Game): boolean {
  if (!canSkipLauncher(game)) return false
  if (typeof game.skipLauncher === 'boolean') return game.skipLauncher
  return game.realExePath!.toLowerCase().startsWith(folderOf(game.exePath).toLowerCase() + '\\')
}

/** Nom du magasin qui lance (ou installe) ce jeu, pour les messages à l'écran. Ex. "Riot Client". */
export function storeName(game: Game): string {
  if (game.launchKind === 'steam' || game.steamAppId) return 'Steam'
  if (game.source === 'epic') return 'Epic Games'
  if (game.source === 'battlenet') return 'Battle.net'
  if (game.source === 'riot') return 'Riot Client'
  if (game.source === 'gog') return 'GOG'
  return 'Le magasin'
}

/**
 * Le jeu est-il lancé par un magasin (Steam, Epic Games, Battle.net, Riot Client) ?
 * Dans ce cas, le programme qu'on démarre (steam.exe, le lien Epic, Battle.net.exe) n'est PAS le jeu :
 * on reconnaît le jeu à son dossier d'installation (gameFolder).
 */
export function launchedByStore(game: Game): boolean {
  return game.launchKind === 'steam' || game.launchKind === 'store'
}
