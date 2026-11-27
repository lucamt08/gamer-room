// Jeux Epic Games installés.
//
// Le launcher Epic écrit un fichier JSON par jeu installé dans :
//   C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\<…>.item
// On y lit : DisplayName (nom), InstallLocation (dossier), LaunchExecutable (le .exe, relatif au dossier),
// AppName / CatalogNamespace / CatalogItemId (pour lancer le jeu par le lien officiel d'Epic).
//
// Les jeux Epic se lancent PAR le launcher (connexion au compte, anti-triche…) :
//   com.epicgames.launcher://apps/<namespace>%3A<item>%3A<appName>?action=launch&silent=true
// Gamer Room ouvre ce lien avec « rundll32 url.dll,FileProtocolHandler » (la façon classique de Windows
// d'ouvrir un lien de programme), puis reconnaît le jeu à son dossier (launchKind 'store').
// ⚠️ Pas avec explorer.exe : lancé par un programme, il ignore le lien et ouvre le dossier Documents.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { findMainExe } from './mainExe'

/** Ce qu'il faut pour ajouter et lancer un jeu Epic. */
export interface EpicGame extends DetectedGame {
  /** Lien qui demande au launcher Epic de lancer le jeu. */
  launchUrl: string
  /** AppName chez Epic (identifiant stable, sert à éviter les doublons). */
  appName: string
}

/** Dossier des fichiers de jeux installés d'Epic. */
function manifestsFolder(): string {
  return join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
}

/** Tous les jeux Epic installés (liste vide si Epic n'est pas installé). */
export function listEpicGames(): EpicGame[] {
  const folder = manifestsFolder()
  let files: string[]
  try {
    files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.item'))
  } catch {
    return [] // Epic n'est pas installé
  }

  const games: EpicGame[] = []
  for (const file of files) {
    try {
      const item = JSON.parse(readFileSync(join(folder, file), 'utf8')) as Record<string, unknown>
      const text = (key: string): string => (typeof item[key] === 'string' ? (item[key] as string) : '')
      const name = text('DisplayName').replace(/[®™©]/g, '').trim()
      const installDir = text('InstallLocation') ? normalize(text('InstallLocation')) : ''
      const appName = text('AppName')
      // Pas un jeu (moteur Unreal, outils…) ou pas lançable
      const categories = Array.isArray(item['AppCategories']) ? (item['AppCategories'] as string[]) : []
      if (!name || !installDir || !appName || !categories.includes('games') || !existsSync(installDir)) continue
      // Téléchargement pas fini : le jeu n'est pas encore installé
      if (item['bIsIncompleteInstall'] === true) continue

      // Le .exe indiqué par Epic, sinon le .exe principal du dossier
      const declared = text('LaunchExecutable') ? join(installDir, text('LaunchExecutable')) : ''
      const exePath = declared && existsSync(declared) ? declared : findMainExe(installDir)
      if (!exePath) continue
      games.push({
        key: `epic:${appName}`,
        source: 'epic',
        name,
        folder: installDir,
        exePath,
        sizeBytes: Number(item['InstallSize']) || null,
        confidence: 'high',
        reasons: ['Epic Games'],
        appName,
        launchUrl: epicUrl(text('CatalogNamespace'), text('CatalogItemId'), appName, 'launch')
      })
    } catch {
      // fichier illisible : on passe au suivant
    }
  }
  return games
}

/** Lien du launcher Epic pour une action ("launch" ou "install") sur un jeu. */
function epicUrl(namespace: string, itemId: string, appName: string, action: 'launch' | 'install'): string {
  const id = [namespace, itemId, appName].map(encodeURIComponent).join('%3A')
  return `com.epicgames.launcher://apps/${id}?action=${action}${action === 'launch' ? '&silent=true' : ''}`
}

/** Le lien Epic contenu dans les arguments d'un jeu, ou null. */
export function epicUrlFromArgs(args: string): string | null {
  return /com\.epicgames\.launcher:\/\/[^\s"]+/.exec(args)?.[0] ?? null
}

/** Lien d'installation à partir du lien de lancement enregistré dans le jeu. */
export function epicInstallUrl(launchUrl: string): string {
  return launchUrl.replace('action=launch&silent=true', 'action=install')
}

/** Programme et arguments qui ouvrent un lien Epic (au lieu d'explorer.exe, qui ouvre Documents). */
export function epicLaunchCommand(launchUrl: string): { exePath: string; args: string } {
  return {
    exePath: join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'rundll32.exe'),
    args: `url.dll,FileProtocolHandler ${launchUrl}`
  }
}

/** Programmes du catalogue Epic qui ne sont pas des jeux à proposer. */
const NOT_GAMES = /test branch|audience|dedicated server|offline installers|\bdemo\b/i

/**
 * Jeux de la bibliothèque Epic PAS installés.
 * Le launcher Epic garde un cache de la bibliothèque du compte dans
 *   C:\ProgramData\Epic\EpicGamesLauncher\Data\Catalog\catcache.bin
 * (du JSON encodé en Base64 : une liste de produits avec titre, catégories, et releaseInfo[].appId = AppName).
 * On garde ceux de la catégorie "games" qui ont un AppName, et qui ne sont pas déjà installés.
 * Le cache est mis à jour par Epic à chaque ouverture du launcher.
 */
export function listEpicNotInstalled(installedAppNames: Set<string>): EpicGame[] {
  const file = join(process.env['ProgramData'] ?? 'C:\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog', 'catcache.bin')
  let items: Record<string, unknown>[]
  try {
    const decoded = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64').toString('utf8')
    items = JSON.parse(decoded) as Record<string, unknown>[]
    if (!Array.isArray(items)) return []
  } catch {
    return [] // Epic pas installé, ou cache illisible
  }

  const games = new Map<string, EpicGame>()
  for (const item of items) {
    const title = typeof item['title'] === 'string' ? item['title'].replace(/[®™©]/g, '').trim() : ''
    const namespace = typeof item['namespace'] === 'string' ? item['namespace'] : ''
    const itemId = typeof item['id'] === 'string' ? item['id'] : ''
    const categories = Array.isArray(item['categories']) ? (item['categories'] as { path?: string }[]).map((c) => c.path) : []
    const releases = Array.isArray(item['releaseInfo']) ? (item['releaseInfo'] as { appId?: string; platform?: string[] }[]) : []
    // La version Windows du jeu (son AppName sert à le lancer et à l'installer)
    const release = releases.find((r) => r.appId && (!r.platform || r.platform.includes('Windows')))
    const appName = release?.appId ?? ''
    if (!title || !namespace || !itemId || !appName || !categories.includes('games') || NOT_GAMES.test(title)) continue
    if (installedAppNames.has(appName) || games.has(appName)) continue
    games.set(appName, {
      key: `epic:${appName}`,
      source: 'epic',
      name: title,
      folder: '',
      exePath: '',
      sizeBytes: null,
      confidence: 'high',
      reasons: ['Epic Games'],
      installed: false,
      appName,
      launchUrl: epicUrl(namespace, itemId, appName, 'launch')
    })
  }
  return [...games.values()]
}
