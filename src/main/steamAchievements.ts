// Succès (trophées) Steam, lus dans les fichiers de Steam sur le PC (sans Internet, sans clé).
//
// Steam garde une copie des succès dans son dossier appcache\stats :
//  - UserGameStatsSchema_<jeu>.bin : la LISTE des succès du jeu (nom, description en plusieurs langues,
//    caché ou non, icônes). Rangés par « stat » puis par « bit » :
//      <jeu> → stats → <numéro de stat> → bits → <numéro de bit> → { name, display { name, desc, hidden, icon, icon_gray } }
//  - UserGameStats_<compte>_<jeu>.bin : TES succès débloqués :
//      cache → <numéro de stat> → { data = un nombre dont chaque bit vaut 1 si le succès est débloqué,
//                                   AchievementTimes → <numéro de bit> → date (secondes depuis 1970) }
// Les deux fichiers sont au format VDF binaire (voir steamVdf.ts). Steam les crée quand on lance le jeu
// (ou qu'on ouvre sa page dans Steam) : un jeu jamais lancé sur ce PC peut ne pas en avoir.
//
// Les icônes sont sur les serveurs de Steam :
//   https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/<jeu>/<icône>

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SteamAchievement } from '@shared/types'
import { findSteamFolder } from './steamLibrary'
import { activeAccountId } from './steamPlaytime'
import { sub, VdfReader, type Kv } from './steamVdf'

const ICON_BASE = 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps'

/** Lit un fichier VDF binaire, ou null s'il est absent / illisible. */
function readVdfFile(file: string): Kv | null {
  try {
    return new VdfReader(readFileSync(file)).block()
  } catch {
    return null
  }
}

/** Texte dans la langue de l'utilisateur : français si le jeu le traduit, sinon anglais. */
function localized(value: string | number | Kv | undefined): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  for (const language of ['french', 'english']) {
    if (typeof value[language] === 'string') return value[language] as string
  }
  const first = Object.entries(value).find(([key, text]) => key !== 'token' && typeof text === 'string')
  return (first?.[1] as string) ?? ''
}

/**
 * Le fichier de TES succès pour ce jeu : celui du compte connecté à Steam,
 * sinon le plus récent (si plusieurs comptes Steam ont été utilisés sur ce PC).
 */
function userStatsFile(statsFolder: string, appId: number): string | null {
  let files: string[]
  try {
    files = readdirSync(statsFolder).filter((f) => f.startsWith('UserGameStats_') && f.endsWith(`_${appId}.bin`))
  } catch {
    return null
  }
  if (files.length === 0) return null
  const account = activeAccountId()
  const mine = account && files.find((f) => f === `UserGameStats_${account}_${appId}.bin`)
  if (mine) return join(statsFolder, mine)
  const newest = files
    .map((f) => ({ path: join(statsFolder, f), time: statSync(join(statsFolder, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0]
  return newest.path
}

/**
 * Les succès d'un jeu Steam (débloqués ou non), ou null si le jeu n'en a pas
 * (ou si Steam ne les a pas encore enregistrés sur ce PC).
 * `globalPercent` est null ici : il vient d'Internet (voir steamStore.ts).
 */
export function readSteamAchievements(appId: number): SteamAchievement[] | null {
  const steamFolder = findSteamFolder()
  if (!steamFolder) return null
  const statsFolder = join(steamFolder, 'appcache', 'stats')

  const schemaRoot = readVdfFile(join(statsFolder, `UserGameStatsSchema_${appId}.bin`))
  const stats = sub(sub(schemaRoot, String(appId)), 'stats')
  if (!stats) return null

  // Mes succès débloqués (fichier absent = aucun débloqué)
  const userFile = userStatsFile(statsFolder, appId)
  const progress = sub(userFile ? readVdfFile(userFile) : null, 'cache')

  const achievements: SteamAchievement[] = []
  for (const [statId, stat] of Object.entries(stats)) {
    const bits = sub(stat as Kv, 'bits')
    if (!bits) continue // une statistique normale (compteur), pas des succès
    const mine = sub(progress, statId)
    const data = typeof mine?.['data'] === 'number' ? (mine['data'] as number) : 0
    const times = sub(mine, 'AchievementTimes')
    for (const [bit, entry] of Object.entries(bits)) {
      if (typeof entry !== 'object') continue
      const display = sub(entry, 'display')
      const unlocked = ((data >>> Number(bit)) & 1) === 1
      const time = Number(times?.[bit])
      const icon = String((unlocked ? display?.['icon'] : display?.['icon_gray']) ?? display?.['icon'] ?? '')
      achievements.push({
        id: String(entry['name'] ?? `${statId}_${bit}`),
        name: localized(display?.['name']),
        description: localized(display?.['desc']),
        hidden: Number(display?.['hidden']) === 1,
        unlockedAt: unlocked ? (time > 0 ? new Date(time * 1000) : new Date(0)).toISOString() : null,
        iconUrl: icon ? `${ICON_BASE}/${appId}/${icon}` : '',
        globalPercent: null
      })
    }
  }
  return achievements.length > 0 ? achievements : null
}
