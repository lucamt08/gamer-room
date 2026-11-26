// Petites fonctions pour lire/écrire un fichier JSON dans le dossier "userData"
// d'Electron (ex. C:\Users\<toi>\AppData\Roaming\Gamer Room).
// Ce dossier est propre à chaque PC : rien de ce qui est dedans n'est dans Git.

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Chemin complet d'un fichier dans userData. */
export function userDataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}

/** Crée un dossier s'il n'existe pas et renvoie son chemin. */
export function ensureDir(path: string): string {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  return path
}

/** Lit un fichier JSON ; renvoie `fallback` s'il n'existe pas ou est illisible. */
export function readJson<T>(fileName: string, fallback: T): T {
  const path = userDataPath(fileName)
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch (error) {
    console.error(`[jsonStore] Impossible de lire ${path}`, error)
    return fallback
  }
}

/**
 * Écrit un fichier JSON de façon "atomique" : on écrit d'abord dans un fichier
 * temporaire puis on le renomme. Si l'appli plante pendant l'écriture,
 * l'ancien fichier reste intact.
 */
export function writeJson(fileName: string, data: unknown): void {
  ensureDir(app.getPath('userData'))
  const path = userDataPath(fileName)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, path)
}
