// Petites fonctions pour les fiches de jeux (gameInfo.ts) : télécharger un JSON, et garder les réponses
// dans un cache sur le PC (dossier userData\game-info) pour ne pas redemander à chaque clic.

import { app, net } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDir, userDataPath } from './jsonStore'

const TIMEOUT = 10_000

/**
 * Comment Gamer Room se présente (en-tête « User-Agent »). Wikipédia / Wikidata limitent à 10 demandes par minute
 * les programmes sans moyen de contact, et à 200 ceux qui donnent une adresse web : on donne donc l'adresse
 * du projet sur GitHub. Rien sur l'utilisateur (ni nom, ni compte, ni e-mail).
 * Voir https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
 */
const USER_AGENT = `GamerRoom/${app.getVersion()} (https://github.com/lucamt08/gamer-room)`

/** Télécharge un JSON. Renvoie null en cas d'erreur, de réponse refusée ou de délai dépassé (pas d'Internet…). */
export async function getJson(url: string): Promise<unknown> {
  try {
    const response = await net.fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT) })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

/** Fichier de cache : userData\game-info\<nom>.json */
function cachePath(name: string): string {
  return join(ensureDir(userDataPath('game-info')), `${name}.json`)
}

/** Lit un fichier du cache, ou null. */
export function readCache<T>(name: string): T | null {
  try {
    const file = cachePath(name)
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null
  } catch {
    return null
  }
}

/** Écrit un fichier du cache (une erreur n'est pas grave : on redemandera la prochaine fois). */
export function writeCache(name: string, data: unknown): void {
  try {
    writeFileSync(cachePath(name), JSON.stringify(data), 'utf8')
  } catch (error) {
    console.warn(`[fiche] Impossible d'enregistrer ${name}`, error)
  }
}

/** Nom de fichier sans caractères interdits : "Batman: Arkham" → "batman-arkham". */
export function safeFileName(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'sans-nom'
}
