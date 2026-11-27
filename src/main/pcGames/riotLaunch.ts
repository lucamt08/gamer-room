// Lancer un jeu Riot jusqu'au bout, sans avoir à cliquer sur « Jouer » dans le Riot Client.
//
// Le problème : Riot a désactivé le lancement automatique de son côté (réglage « autoLaunch.disabled »
// envoyé par ses serveurs, visible dans les journaux du Riot Client). La commande
//   RiotClientServices.exe --launch-product=valorant --launch-patchline=live
// ouvre donc seulement le Riot Client sur la page du jeu.
//
// La solution : le Riot Client a une petite interface locale (une « porte » accessible seulement depuis ce PC),
// celle que sa propre fenêtre utilise quand on clique sur « Jouer ». Ses coordonnées sont dans le fichier
//   %LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile
// sous la forme "Riot Client:<pid>:<port>:<mot de passe>:https" (mot de passe temporaire, changé à chaque
// démarrage du Riot Client). On lui envoie la demande :
//   POST https://127.0.0.1:<port>/product-launcher/v1/products/<produit>/patchlines/<version>
// Rien ne sort du PC, et le Riot Client fait comme d'habitude la connexion au compte et l'anti-triche Vanguard.
// On n'utilise QUE cette demande de lancement (jamais rien qui touche au compte).
//
// Le Riot Client met quelques secondes à être prêt (démarrage, connexion) : on réessaie toutes les 2 s,
// jusqu'à ce que le jeu démarre (90 s max). Si l'interface ne répond pas (Riot l'a changée…), rien de grave :
// le Riot Client reste ouvert sur la page du jeu, et on clique sur « Jouer » comme avant.

import { readFileSync } from 'node:fs'
import { request } from 'node:https'
import { join } from 'node:path'
import type { Game } from '@shared/types'

const RETRY_DELAY = 2_000 // on réessaie toutes les 2 s
const GIVE_UP_AFTER = 90_000 // on abandonne après 90 s (le joueur peut toujours cliquer sur « Jouer »)

/** Ce jeu est-il lancé par le Riot Client ? */
export function isRiotLaunch(game: Game): boolean {
  return game.launchKind === 'store' && game.source === 'riot' && !!game.storeId
}

/** Port et mot de passe de l'interface locale du Riot Client, ou null s'il n'est pas (encore) ouvert. */
function readLockfile(): { port: number; password: string } | null {
  const localAppData = process.env['LOCALAPPDATA']
  if (!localAppData) return null
  try {
    const parts = readFileSync(join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'lockfile'), 'utf8').trim().split(':')
    const port = Number(parts[2])
    const password = parts[3]
    return port > 0 && password ? { port, password } : null
  } catch {
    return null // Riot Client fermé
  }
}

/** Envoie la demande de lancement. Renvoie le code de réponse (200, 404…), ou 0 si pas de réponse. */
function postLaunch(port: number, password: string, product: string, patchline: string): Promise<number> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/product-launcher/v1/products/${encodeURIComponent(product)}/patchlines/${encodeURIComponent(patchline)}`,
        headers: { Authorization: 'Basic ' + Buffer.from(`riot:${password}`).toString('base64'), 'Content-Length': 0 },
        // Le Riot Client utilise son propre certificat (pas reconnu par Windows) : normal pour une interface
        // locale. On ne le vérifie pas, mais on ne parle qu'à 127.0.0.1 (ce PC).
        rejectUnauthorized: false,
        timeout: 5_000
      },
      (res) => {
        res.resume() // on ne lit pas la réponse
        resolve(res.statusCode ?? 0)
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(0))
    req.end()
  })
}

/**
 * Demande au Riot Client de lancer le jeu, en réessayant jusqu'à ce qu'il accepte.
 * `stop()` dit quand arrêter : le jeu a démarré, ou le lancement a été annulé.
 * Ne lance jamais d'erreur.
 */
export async function requestRiotLaunch(game: Game, stop: () => boolean): Promise<void> {
  const [product, patchline] = (game.storeId ?? '').split('.')
  if (!product || !patchline) return
  const started = Date.now()
  let lastStatus = -1
  while (Date.now() - started < GIVE_UP_AFTER && !stop()) {
    const lock = readLockfile()
    if (lock) {
      const status = await postLaunch(lock.port, lock.password, product, patchline)
      if (status >= 200 && status < 300) {
        console.log(`[riot] Le Riot Client lance "${game.name}" (après ${Math.round((Date.now() - started) / 1000)} s)`)
        return
      }
      if (status !== lastStatus) console.log(`[riot] Riot Client pas encore prêt (réponse ${status || 'aucune'}), on réessaie`)
      lastStatus = status
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
  }
  if (!stop()) console.warn('[riot] Le Riot Client n\'a pas accepté le lancement : clique sur « Jouer » dans le Riot Client')
}
