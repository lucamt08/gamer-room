// Lecture du registre Windows (en lecture seule), avec la commande « reg query » de Windows.
// Utilisé par les launchers qui notent leurs jeux dans le registre (GOG, Riot Games…).

import { execFileSync } from 'node:child_process'

/**
 * Valeurs de chaque sous-clé d'une clé du registre : chemin de la sous-clé → { nom de la valeur (minuscules) → texte }.
 * Les nombres (REG_DWORD) sont rendus tels que Windows les écrit, ex. "0x20f3a5e" (Number() sait les lire).
 * Clé absente → liste vide.
 */
export function readRegistryTree(key: string): Map<string, Record<string, string>> {
  const tree = new Map<string, Record<string, string>>()
  let output: string
  try {
    output = execFileSync('reg', ['query', key, '/s'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'] // clé absente : pas de message d'erreur de Windows dans la console
    })
  } catch {
    return tree // clé absente
  }
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
