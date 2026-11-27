// Lecture du registre Windows (en lecture seule), avec la commande « reg query » de Windows.
// Utilisé par les launchers qui notent leurs jeux dans le registre (GOG, Riot Games…).
//
// Deux versions :
//  - readRegistryTree / findRegistryKeys : attendent la réponse de Windows (simple, pour une action ponctuelle) ;
//  - …Async : n'attendent pas en bloquant. À utiliser dans tout ce qui tourne en boucle (suivi toutes les
//    10 s…) : pendant qu'une commande bloquante tourne, l'appli entière est figée (souris, clavier, manette).

import { execFile, execFileSync } from 'node:child_process'

/** Valeurs de chaque sous-clé : chemin de la sous-clé → { nom de la valeur (minuscules) → texte }. */
export type RegistryTree = Map<string, Record<string, string>>

const OPTIONS = {
  encoding: 'utf8' as const,
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024
}

/** Lit la sortie de « reg query … /s » : sous-clés et leurs valeurs. */
function parseTree(output: string): RegistryTree {
  const tree: RegistryTree = new Map()
  let current: Record<string, string> | null = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) {
      current = {}
      tree.set(line.trim(), current)
      continue
    }
    const match = /^\s+(.+?)\s+REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)$/.exec(line)
    if (match && current) current[match[1].toLowerCase()] = match[2].trim()
  }
  return tree
}

/** Lit la sortie de « reg query … /f … /k » : seulement les chemins des clés trouvées. */
function parseKeys(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('HKEY_'))
    .map((line) => line.trim())
}

/** Lance « reg » sans bloquer l'appli. Renvoie '' si la clé n'existe pas. */
function regAsync(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg', args, OPTIONS, (error, stdout) => resolve(error ? '' : stdout))
  })
}

/** Lance « reg » en attendant la réponse. Renvoie '' si la clé n'existe pas. */
function regSync(args: string[]): string {
  try {
    return execFileSync('reg', args, { ...OPTIONS, stdio: ['ignore', 'pipe', 'ignore'] }) // pas de message d'erreur de Windows
  } catch {
    return ''
  }
}

/**
 * Valeurs de chaque sous-clé d'une clé du registre : chemin de la sous-clé → { nom de la valeur (minuscules) → texte }.
 * Les nombres (REG_DWORD) sont rendus tels que Windows les écrit, ex. "0x20f3a5e" (Number() sait les lire).
 * Clé absente → liste vide.
 */
export function readRegistryTree(key: string): RegistryTree {
  return parseTree(regSync(['query', key, '/s']))
}

export async function readRegistryTreeAsync(key: string): Promise<RegistryTree> {
  return parseTree(await regAsync(['query', key, '/s']))
}

/**
 * Sous-clés directes de `key` dont le nom contient `text` (ex. les « Riot Game … » de la liste des programmes).
 * Bien plus rapide que de lire tout l'arbre (21 ms au lieu de 700 ms pour la liste des programmes installés).
 */
export function findRegistryKeys(key: string, text: string): string[] {
  return parseKeys(regSync(['query', key, '/f', text, '/k']))
}

export async function findRegistryKeysAsync(key: string, text: string): Promise<string[]> {
  return parseKeys(await regAsync(['query', key, '/f', text, '/k']))
}
