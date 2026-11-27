// Trouver le .exe principal d'un dossier de jeu (celui qu'on double-cliquerait pour jouer).
//
// On regarde les .exe du dossier et de ses sous-dossiers (3 niveaux max), en ignorant :
//  - les installateurs, désinstalleurs, redistribuables, rapports de plantage, anti-triche, launchers…
//    (dont les launchers connus, voir knownLaunchers.ts : LeagueClient.exe n'est pas le jeu) ;
//  - les dossiers d'outils (_CommonRedist, DirectX, Support…).
// Puis on garde le moins profond (un jeu Unreal a un petit .exe à la racine qui lance le vrai jeu :
// c'est lui qu'on lance), et à égalité le plus gros.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isKnownLauncherExe } from '../knownLaunchers'

/** .exe qui ne sont jamais le jeu : installateurs, rapports de plantage, anti-triche, launchers, outils… */
export const NOT_THE_GAME =
  /setup|unins|install|redist|dotnet|ndp\d|dxsetup|vcredist|crash|report|helper|updater|uploader|handler|prompt|launch|bootstrap|anticheat|easyanticheat|battleye|cef|service|benchmark|config|settings|editor|server|unitycrashhandler|ue4prereq|dxwebsetup|touchup|cleanup/i

/** Dossiers qu'on ne fouille pas (installateurs, outils, moteur…). */
export const SKIPPED_FOLDERS =
  /^(_?redist|_commonredist|__installer|directx|support|installers?|redistributables?|prereqs?|tools?|easyanticheat|battleye|\.[^.]+)$/i

/** Le .exe principal du dossier, ou null s'il n'y en a pas. */
export function findMainExe(folder: string): string | null {
  let best: { path: string; depth: number; size: number } | null = null
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.test(entry.name)) walk(path, depth + 1)
      } else if (entry.name.toLowerCase().endsWith('.exe') && !NOT_THE_GAME.test(entry.name) && !isKnownLauncherExe(entry.name)) {
        let size = 0
        try {
          size = statSync(path).size
        } catch {
          continue
        }
        if (!best || depth < best.depth || (depth === best.depth && size > best.size)) best = { path, depth, size }
      }
    }
  }
  walk(folder, 0)
  return best ? (best as { path: string }).path : null
}
