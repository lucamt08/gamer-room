// « + Jeux du PC » : rassemble les jeux trouvés sur le PC (hors Steam) et les ajoute à Gamer Room.
//
// Sources, de la plus sûre à la moins sûre :
//  - Epic Games, Battle.net, GOG : leurs propres listes de jeux installés (voir epicGames.ts, etc.),
//    plus les jeux de la bibliothèque Epic pas installés (bouton « Installer », comme pour Steam) ;
//  - la détection générale des jeux .exe (voir pcGameDetect.ts), pour les jeux sans launcher.
// Comme pour Steam, on ne propose que les jeux PAS ENCORE dans Gamer Room : on peut relancer la recherche
// après avoir installé un nouveau jeu, sans créer de doublon.

import { basename, join, parse } from 'node:path'
import type { DetectedGame, Game } from '@shared/types'
import { addGameFromPath, getGames, insertGame, updateGame } from '../library'
import { getSettings } from '../settings'
import { readExeInfo } from '../exeInfo'
import { listEpicGames, listEpicNotInstalled, type EpicGame } from './epicGames'
import { listBattleNetGames, type BattleNetGame } from './battleNetGames'
import { listGogGames, type GogGame } from './gogGames'
import { detectPcGames, gameRoot } from './pcGameDetect'

type AnyDetected = EpicGame | BattleNetGame | GogGame | DetectedGame

/** Le résultat d'une recherche : les nouveaux jeux, et combien sont déjà dans Gamer Room. */
export interface PcGamesResult {
  games: DetectedGame[]
  alreadyAdded: number
}

/** Ce jeu trouvé est-il déjà dans Gamer Room ? (même magasin + même identifiant, ou même .exe) */
function isAlreadyAdded(found: AnyDetected, library: Game[]): boolean {
  const storeId = 'appName' in found ? found.appName : 'uid' in found ? found.uid : 'gameId' in found ? found.gameId : null
  const exe = found.exePath.toLowerCase()
  return library.some(
    (g) =>
      (storeId && g.source === found.source && g.storeId === storeId) ||
      (exe !== '' && (g.exePath.toLowerCase() === exe || g.realExePath?.toLowerCase() === exe))
  )
}

/** Tous les jeux trouvés sur le PC (y compris ceux déjà dans Gamer Room). */
function findAll(): AnyDetected[] {
  const library = getGames()
  const epic = listEpicGames()
  const epicNotInstalled = listEpicNotInstalled(new Set(epic.map((g) => g.appName)))
  const stores: AnyDetected[] = [...epic, ...listBattleNetGames(), ...listGogGames()]
  // La détection générale ignore les dossiers déjà couverts : magasins, et dossiers des jeux de Gamer Room
  // (dossier d'installation, et dossier "racine" de leur .exe : un petit outil rangé dans le dossier
  // de Hades II n'est pas un nouveau jeu)
  const libraryExes = library.flatMap((g) => [g.exePath, g.realExePath ?? '']).filter(Boolean)
  const folders = [
    ...stores.map((g) => g.folder).filter(Boolean),
    ...library.map((g) => g.gameFolder).filter((f): f is string => !!f),
    ...libraryExes.map(gameRoot).filter((root) => parse(root).root !== root && !/\\windows\b/i.test(root))
  ]
  const exes = new Set(libraryExes.map((p) => p.toLowerCase()))
  return [...stores, ...epicNotInstalled, ...detectPcGames(getSettings().gameFolders, { folders, exes })]
}

/** Recherche les jeux du PC pas encore dans Gamer Room. */
export function listPcGames(): PcGamesResult {
  const library = getGames()
  const all = findAll()
  // On n'envoie à l'interface que les infos communes (pas les liens de lancement)
  const games = all
    .filter((g) => !isAlreadyAdded(g, library))
    .map(({ key, source, name, folder, exePath, sizeBytes, confidence, reasons, installed }) => ({
      key,
      source,
      name,
      folder,
      exePath,
      sizeBytes,
      confidence,
      reasons,
      installed
    }))
  return { games, alreadyAdded: all.length - games.length }
}

/** Ajoute un jeu Epic (ou Battle.net) lancé par son magasin, comme un jeu Steam. */
function addStoreGame(found: EpicGame | BattleNetGame, exe: string, args: string, storeId: string): Game {
  // On part de l'ajout "normal" de son .exe (vérifications, éditeur, option administrateur retirée…)
  const game = addGameFromPath(found.exePath)
  return updateGame(game.id, {
    name: found.name,
    exePath: exe,
    args,
    workingDir: found.folder,
    launchKind: 'store',
    // Le vrai jeu (sauf si Epic indique un petit launcher, ex. FortniteLauncher.exe : on reconnaîtra le jeu à son dossier)
    realExePath: /launch/i.test(basename(found.exePath)) ? null : found.exePath,
    gameFolder: found.folder,
    publisher: readExeInfo(found.exePath).publisher ?? game.publisher,
    source: found.source,
    storeId,
    sizeBytes: found.sizeBytes
  })
}

/** Ajoute à Gamer Room les jeux choisis (par leur clé). On refait la recherche : l'interface n'envoie que des clés. */
export function addPcGames(keys: string[]): Game[] {
  const wanted = new Set(keys)
  const library = getGames()
  const added: Game[] = []
  for (const found of findAll()) {
    if (!wanted.has(found.key) || isAlreadyAdded(found, library)) continue
    try {
      if ('launchUrl' in found && found.installed === false) {
        // Epic pas installé : pas encore de .exe. Il se lancera par le lien Epic une fois installé.
        added.push(
          insertGame({
            name: found.name,
            exePath: join(process.env['SystemRoot'] ?? 'C:\\Windows', 'explorer.exe'),
            args: `"${found.launchUrl}"`,
            workingDir: '',
            coverFile: null,
            steamGridDbId: null,
            forceFullscreen: true,
            lastPlayedAt: null,
            launchKind: 'store',
            realExePath: null,
            gameFolder: null,
            source: 'epic',
            storeId: found.appName,
            installed: false
          })
        )
      } else if ('launchUrl' in found) {
        // Epic : on ouvre le lien du launcher Epic avec l'Explorateur Windows
        const explorer = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'explorer.exe')
        added.push(addStoreGame(found, explorer, `"${found.launchUrl}"`, found.appName))
      } else if ('uid' in found && found.launcher) {
        // Battle.net : Battle.net.exe --exec="launch <code>"
        added.push(addStoreGame(found, found.launcher.exe, found.launcher.args, found.uid))
      } else {
        // GOG, Battle.net sans code connu, jeux sans launcher : on lance le .exe directement
        const game = addGameFromPath(found.exePath)
        const patch: Partial<Game> = { name: found.name, source: found.source }
        if ('gameId' in found) Object.assign(patch, { args: found.args, workingDir: found.workingDir, storeId: found.gameId, gameFolder: found.folder })
        if ('uid' in found) Object.assign(patch, { storeId: found.uid, gameFolder: found.folder })
        added.push(updateGame(game.id, patch))
      }
    } catch (error) {
      console.warn(`[jeux du PC] Impossible d'ajouter "${found.name}"`, error)
    }
  }
  return added
}
