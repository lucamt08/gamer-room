// Les launchers connus : programmes des magasins (Steam, Epic, Riot…) qui ne sont jamais « le jeu ».
//
// Utilisé à plusieurs endroits :
//  - la détection des jeux du PC (pcGames/pcGameDetect.ts) : un launcher n'est pas un jeu à proposer ;
//  - le .exe principal d'un dossier de jeu (pcGames/mainExe.ts) : ex. dans le dossier de League of Legends,
//    LeagueClient.exe est le salon (lobby), le vrai jeu est Game\League of Legends.exe ;
//  - le lancement (gameLauncher.ts) : la fenêtre d'un launcher rangé dans le dossier du jeu (le salon de
//    League of Legends) est un launcher, pas le jeu (pas de plein écran forcé dessus) ;
//  - le compteur de temps de jeu (playtimeTracker.ts) : le temps passé dans un launcher ne compte pas.

import { basename } from 'node:path'

/** Noms des .exe des launchers connus. */
const LAUNCHER_EXES =
  /^(steam|epicgameslauncher|battle\.net|galaxyclient|riotclientservices|riotclientux|riot client|leagueclient(ux|uxrender)?|upc|ubisoftconnect|eadesktop|origin|playnite.*|gog galaxy)\.exe$/i

/** Ce .exe (nom ou chemin complet) est-il un launcher connu ? */
export function isKnownLauncherExe(exe: string | null | undefined): boolean {
  return !!exe && LAUNCHER_EXES.test(basename(exe))
}
