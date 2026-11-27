// Jeux Riot Games (VALORANT, League of Legends, Teamfight Tactics, Legends of Runeterra, 2XKO).
//
// Où Riot range ses informations (les mêmes sur tous les PC : seuls les dossiers des jeux changent) :
//  - C:\ProgramData\Riot Games\RiotClientInstalls.json
//      → où est installé le Riot Client (RiotClientServices.exe), ex. "rc_live": "C:/Riot Games/Riot Client/…"
//  - C:\ProgramData\Riot Games\Metadata\<produit>.<version>\<produit>.<version>.product_settings.yaml
//      → un dossier par jeu connu du Riot Client. Le fichier .yaml donne le dossier d'installation du jeu
//        (ligne product_install_full_path). <produit> = ex. "valorant", <version> = "live" (ou "pbe" : serveur de test)
//  - le registre, HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game <produit>.<version>
//      → le nom affiché ("VALORANT") et la taille sur le disque (EstimatedSize, en Ko), comme dans
//        « Ajouter ou supprimer des programmes ».
//
// Les jeux Riot se lancent PAR le Riot Client (connexion au compte, mises à jour, anti-triche Vanguard) :
//   RiotClientServices.exe --launch-product=valorant --launch-patchline=live
// C'est la commande des raccourcis du bureau créés par Riot. Si le Riot Client est fermé, il s'ouvre, se
// connecte, puis lance le jeu tout seul. Gamer Room reconnaît ensuite le jeu à son dossier (launchKind 'store').
//
// Jeux pas installés : tous les jeux Riot sont gratuits, le Riot Client propose donc toujours tous ses jeux.
// La même commande ouvre le Riot Client sur la page du jeu, avec son bouton « Installer ».
// Riot ne garde ni temps de jeu ni taille à télécharger sur le PC : pour ces jeux, c'est Gamer Room qui compte
// le temps de jeu (playtimeTracker.ts), et la taille est connue une fois le jeu installé.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { findMainExe } from './mainExe'
import { readRegistryTree } from './registry'

/** Ce qu'il faut pour ajouter et lancer un jeu Riot. */
export interface RiotGame extends DetectedGame {
  /** Identifiant chez Riot : "<produit>.<version>", ex. "valorant.live" (sert à éviter les doublons). */
  riotId: string
  /** Commande qui demande au Riot Client de lancer (ou d'installer) le jeu. */
  launcher: { exe: string; args: string }
}

/**
 * Les jeux du Riot Client, avec leur nom. Sert à nommer les jeux et à proposer ceux pas installés.
 * (Un jeu installé absent de cette liste est quand même trouvé : son nom vient alors du registre.)
 */
const RIOT_PRODUCTS: Record<string, string> = {
  valorant: 'VALORANT',
  league_of_legends: 'League of Legends',
  teamfighttactics: 'Teamfight Tactics',
  bacon: 'Legends of Runeterra',
  lion: '2XKO'
}

/** Dossier des informations de Riot : C:\ProgramData\Riot Games. */
function riotDataFolder(): string {
  return join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'Riot Games')
}

/** Informations du registre (« Ajouter ou supprimer des programmes ») : "<produit>.<version>" → nom, taille. */
function readUninstallEntries(): Map<string, { name: string; sizeBytes: number | null; folder: string }> {
  const entries = new Map<string, { name: string; sizeBytes: number | null; folder: string }>()
  for (const root of ['HKCU', 'HKLM']) {
    for (const [key, values] of readRegistryTree(`${root}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall`)) {
      const id = /\\Riot Game ([^\\]+)$/i.exec(key)?.[1]
      if (!id || entries.has(id)) continue
      const sizeKb = Number(values['estimatedsize'])
      entries.set(id, {
        name: (values['displayname'] ?? '').replace(/[®™©]/g, '').trim(),
        sizeBytes: sizeKb > 0 ? sizeKb * 1024 : null,
        folder: values['installlocation'] ? normalize(values['installlocation']) : ''
      })
    }
  }
  return entries
}

/** Chemin de RiotClientServices.exe, ou null si le Riot Client n'est pas installé. */
export function findRiotClient(): string | null {
  const candidates: string[] = []
  // 1. Le fichier où Riot note l'emplacement de son client
  try {
    const installs = JSON.parse(readFileSync(join(riotDataFolder(), 'RiotClientInstalls.json'), 'utf8')) as Record<string, unknown>
    for (const value of [installs['rc_live'], installs['rc_default'], installs['patchlines'], installs['associated_client']]) {
      if (typeof value === 'string') candidates.push(value)
      else if (value && typeof value === 'object') candidates.push(...Object.values(value).filter((v): v is string => typeof v === 'string'))
    }
  } catch {
    // fichier absent ou illisible : on essaie le registre
  }
  // 2. Le registre (entrée « Riot Client » de « Ajouter ou supprimer des programmes »)
  for (const [id, entry] of readUninstallEntries()) {
    if (/^riot_client/i.test(id) && entry.folder) candidates.push(join(entry.folder, 'RiotClientServices.exe'))
  }
  const found = candidates.map((path) => normalize(path)).find((path) => existsSync(path))
  return found ?? null
}

/** Commande qui demande au Riot Client de lancer un jeu (ou d'ouvrir sa page pour l'installer). */
function riotCommand(client: string, riotId: string): { exe: string; args: string } {
  const [product, patchline] = riotId.split('.')
  return { exe: client, args: `--launch-product=${product} --launch-patchline=${patchline}` }
}

/** "league_of_legends" → "League Of Legends" (pour un jeu Riot inconnu de RIOT_PRODUCTS). */
function prettyName(product: string): string {
  return product.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Les jeux notés dans le dossier Metadata de Riot : "<produit>.<version>" → dossier d'installation. */
function readProductSettings(): Map<string, string> {
  const products = new Map<string, string>()
  const metadata = join(riotDataFolder(), 'Metadata')
  let folders: string[]
  try {
    folders = readdirSync(metadata)
  } catch {
    return products // Riot Client jamais installé
  }
  for (const folder of folders) {
    // Seulement les dossiers "<produit>.<version>" (pas "Riot Client", ni "league_of_legends.live.game_patch")
    if (!/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(folder)) continue
    try {
      const yaml = readFileSync(join(metadata, folder, `${folder}.product_settings.yaml`), 'utf8')
      const path = /^product_install_full_path:\s*"?([^"\r\n]+?)"?\s*$/m.exec(yaml)?.[1]
      if (path) products.set(folder.toLowerCase(), normalize(path))
    } catch {
      // pas de fichier de réglages : ce jeu n'a jamais été installé
    }
  }
  return products
}

/** Tous les jeux Riot installés (liste vide si le Riot Client n'est pas installé). */
export function listRiotGames(): RiotGame[] {
  const client = findRiotClient()
  if (!client) return []
  const uninstall = readUninstallEntries()
  const games: RiotGame[] = []
  for (const [riotId, folder] of readProductSettings()) {
    // Le dossier noté par Riot peut ne plus exister (jeu désinstallé, serveur de test jamais téléchargé…)
    if (!existsSync(folder)) continue
    const exePath = findMainExe(folder)
    if (!exePath) continue // téléchargement pas encore commencé
    const [product, patchline] = riotId.split('.')
    const entry = uninstall.get(riotId)
    let name = entry?.name || RIOT_PRODUCTS[product] || prettyName(product)
    if (patchline !== 'live' && !name.toLowerCase().includes(patchline)) name += ` (${patchline.toUpperCase()})`
    games.push({
      key: `riot:${riotId}`,
      source: 'riot',
      name,
      folder,
      exePath,
      sizeBytes: entry?.sizeBytes ?? null,
      confidence: 'high',
      reasons: ['Riot Games'],
      riotId,
      launcher: riotCommand(client, riotId)
    })
  }
  return games
}

/** Les jeux du Riot Client PAS installés (version normale "live"), avec le bouton « Installer ». */
export function listRiotNotInstalled(installedIds: Set<string>): RiotGame[] {
  const client = findRiotClient()
  if (!client) return [] // pas de Riot Client : impossible d'installer
  return Object.entries(RIOT_PRODUCTS)
    .filter(([product]) => !installedIds.has(`${product}.live`))
    .map(([product, name]) => ({
      key: `riot:${product}.live`,
      source: 'riot' as const,
      name,
      folder: '',
      exePath: '',
      sizeBytes: null,
      confidence: 'high' as const,
      reasons: ['Riot Games'],
      installed: false,
      riotId: `${product}.live`,
      launcher: riotCommand(client, `${product}.live`)
    }))
}

/**
 * Ouvre le Riot Client sur la page d'un jeu pas installé (il y affiche son bouton « Installer »).
 * `riotId` = "valorant.live". On reprend l'emplacement actuel du Riot Client (il a pu être déplacé).
 */
export function openRiotInstall(riotId: string): void {
  const client = findRiotClient()
  if (!client) throw new Error("Le Riot Client n'est pas installé sur ce PC.")
  const { exe, args } = riotCommand(client, riotId)
  const child = spawn(exe, args.split(' '), { cwd: dirname(exe), detached: true, stdio: 'ignore' })
  child.once('error', (error) => console.warn('[riot] Ouverture du Riot Client impossible', error.message))
  child.unref()
}
