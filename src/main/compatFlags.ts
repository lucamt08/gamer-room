// Retire l'option Windows « Exécuter ce programme en tant qu'administrateur » d'un jeu.
//
// Pourquoi ? Avec cette option, Windows affiche la fenêtre "Contrôle de compte d'utilisateur"
// et refuse que le hub lance le jeu directement (erreur EACCES). Les jeux n'en ont presque
// jamais besoin, et elle ne change rien aux performances.
//
// Où Windows la range : dans le registre, clé
//   HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers
// une valeur par programme : nom = chemin du .exe, contenu = "~ RUNASADMIN" (+ d'autres options éventuelles).
// On ne touche qu'à l'option de l'utilisateur (HKCU), jamais à celles de l'ordinateur entier (HKLM).
// On garde les autres options (ex. HIGHDPIAWARE) : on retire seulement RUNASADMIN.
//
// On passe par reg.exe (fourni avec Windows) : pas d'appel Win32 ici.

import { execFileSync } from 'node:child_process'

const LAYERS_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'

/** Lit les options de compatibilité d'un .exe, ou null s'il n'en a pas. */
function readLayers(exePath: string): string | null {
  try {
    const output = execFileSync('reg', ['query', LAYERS_KEY, '/v', exePath], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'] // on cache le message d'erreur de reg.exe quand il n'y a rien
    })
    const match = /REG_SZ\s+(.*)$/m.exec(output)
    return match ? match[1].trim() : null
  } catch {
    return null // pas d'options pour ce programme
  }
}

/**
 * Retire « Exécuter en tant qu'administrateur » pour ce .exe.
 * Renvoie true si l'option était cochée et a été retirée. Ne lance jamais d'erreur.
 */
export function removeRunAsAdmin(exePath: string | null | undefined): boolean {
  if (!exePath) return false
  const layers = readLayers(exePath)
  if (!layers || !/\bRUNASADMIN\b/i.test(layers)) return false

  try {
    const kept = layers.split(/\s+/).filter((flag) => flag && flag.toUpperCase() !== 'RUNASADMIN')
    if (kept.every((flag) => flag === '~')) {
      // Plus aucune option : on supprime la valeur
      execFileSync('reg', ['delete', LAYERS_KEY, '/v', exePath, '/f'], { windowsHide: true })
    } else {
      execFileSync('reg', ['add', LAYERS_KEY, '/v', exePath, '/t', 'REG_SZ', '/d', kept.join(' '), '/f'], {
        windowsHide: true
      })
    }
    console.log(`[compat] Option "Exécuter en tant qu'administrateur" retirée : ${exePath}`)
    return true
  } catch (error) {
    console.warn(`[compat] Impossible de retirer l'option administrateur de ${exePath}`, error)
    return false
  }
}
