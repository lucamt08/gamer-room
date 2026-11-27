// Cache local des jaquettes : les images sont téléchargées une seule fois dans
// userData/covers, puis affichées par l'interface via l'adresse spéciale
// "cover://img/<nom-du-fichier>".
//
// Pourquoi une adresse spéciale ? Pour des raisons de sécurité, l'interface
// n'a pas le droit de lire directement des fichiers du disque (file://).
// Le protocole "cover://" ne donne accès QU'AU dossier des jaquettes.

import { net, protocol } from 'electron'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureDir, userDataPath } from './jsonStore'

export const COVER_SCHEME = 'cover'

export function coversDir(): string {
  return ensureDir(userDataPath('covers'))
}

/** Chemin complet d'une jaquette en cache. `basename` empêche de sortir du dossier. */
export function coverPath(fileName: string): string {
  return join(coversDir(), basename(fileName))
}

/** À appeler AVANT que l'appli soit prête (app.whenReady). */
export function registerCoverSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    // corsEnabled : l'étagère 3D (WebGL) a besoin d'images « autorisées » pour en faire des textures
    { scheme: COVER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

/** À appeler APRÈS app.whenReady : sert les fichiers du dossier covers. */
export function handleCoverProtocol(): void {
  protocol.handle(COVER_SCHEME, async (request) => {
    const fileName = decodeURIComponent(new URL(request.url).pathname)
    const file = await net.fetch(pathToFileURL(coverPath(fileName)).toString())
    // On autorise l'interface à utiliser l'image comme texture WebGL (voir ShelfScene.ts).
    // Sans risque : ce protocole ne sert que les jaquettes, et seulement à notre propre interface.
    const headers = new Headers(file.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(file.body, { status: file.status, headers })
  })
}

/** Télécharge une image et l'enregistre dans le cache. Renvoie le nom du fichier. */
export async function downloadCover(url: string, gameId: string): Promise<string> {
  const response = await net.fetch(url)
  if (!response.ok) throw new Error(`Téléchargement de la jaquette impossible (HTTP ${response.status})`)
  const extension = (url.split('?')[0].match(/\.(png|jpe?g|webp)$/i)?.[1] ?? 'png').toLowerCase()
  // On ajoute l'heure au nom pour que l'interface recharge bien l'image si on change de jaquette
  const fileName = `${gameId}-${Date.now()}.${extension}`
  const { writeFile } = await import('node:fs/promises')
  await writeFile(coverPath(fileName), Buffer.from(await response.arrayBuffer()))
  return fileName
}
