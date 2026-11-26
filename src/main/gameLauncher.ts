// Lancement d'un jeu + suivi de son exécution.
//
// Déroulé quand on lance un jeu :
//  1. on note les fenêtres déjà ouvertes (pour reconnaître la "nouvelle" fenêtre du jeu) ;
//  2. on démarre le .exe ;
//  3. on cache le hub ;
//  4. pendant ~30 s, on cherche la fenêtre du jeu et on la passe en plein écran
//     sans bordure (voir windowManager.ts) ;
//  5. toutes les secondes, on vérifie si le jeu tourne encore ;
//     quand il est fermé, on réaffiche le hub.
//
// Le raccourci global (Ctrl+Alt+F4 par défaut) appelle killRunningGame().

import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import type { Game, RunningState } from '@shared/types'
import * as wm from './windowManager'

// Réglages du suivi (en millisecondes)
const WINDOW_SEARCH_TIMEOUT = 30_000 // on cherche la fenêtre pendant 30 s max
const WINDOW_SEARCH_INTERVAL = 500 // toutes les 0,5 s
const WINDOW_STABLE_DELAY = 5_000 // une fois en plein écran, on surveille encore 5 s
const PROCESS_CHECK_INTERVAL = 1_000 // on vérifie que le jeu tourne toutes les secondes

/** Tout ce qu'on sait sur le jeu en cours. */
interface Session {
  game: Game
  /** Pid du processus qu'on a lancé nous-mêmes. */
  rootPid: number
  /** Tous les pids "du jeu" qu'on a vus vivants (launcher, enfants, fenêtre trouvée…). */
  knownPids: Set<number>
  /** La fenêtre du jeu, une fois trouvée. */
  gameWindow: wm.Hwnd | null
  /** Fenêtres présentes avant le lancement. */
  windowsBeforeLaunch: Set<wm.Hwnd>
  /** La recherche de fenêtre est-elle terminée (trouvée et stable, ou délai dépassé) ? */
  searchDone: boolean
  timers: NodeJS.Timeout[]
}

let session: Session | null = null
let hubWindow: BrowserWindow | null = null
let notify: (state: RunningState) => void = () => {}

/** À appeler une fois au démarrage : on donne la fenêtre du hub et une fonction pour prévenir l'interface. */
export function initGameLauncher(window: BrowserWindow, onState: (state: RunningState) => void): void {
  hubWindow = window
  notify = onState
}

export function isGameRunning(): boolean {
  return session !== null
}

/**
 * Découpe une ligne d'arguments en liste, en respectant les guillemets.
 * Exemple : `-w 1920 "C:\Mon dossier\save"` → ['-w', '1920', 'C:\Mon dossier\save']
 */
export function parseArgs(line: string): string[] {
  const result: string[] = []
  const regex = /"([^"]*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(line)) !== null) {
    result.push(match[1] ?? match[2])
  }
  return result
}

/** Lance un jeu. Renvoie une promesse qui se résout dès que le processus a démarré. */
export function launchGame(game: Game): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session) {
      reject(new Error('Un jeu est déjà en cours.'))
      return
    }
    if (!existsSync(game.exePath)) {
      reject(new Error(`Fichier introuvable : ${game.exePath}`))
      return
    }

    // 1. Fenêtres déjà présentes
    const windowsBeforeLaunch = new Set(wm.listAllWindowHandles())

    // 2. Démarrage du jeu
    //    detached + unref : le jeu vit sa vie, même si le hub plante.
    const child = spawn(game.exePath, parseArgs(game.args), {
      cwd: existsSync(game.workingDir) ? game.workingDir : undefined,
      detached: true,
      stdio: 'ignore'
    })

    child.once('error', (error) => {
      endSession('Erreur au lancement')
      reject(new Error(`Impossible de lancer le jeu : ${error.message}`))
    })

    child.once('spawn', () => {
      child.unref()
      const pid = child.pid!
      console.log(`[launcher] "${game.name}" démarré (pid ${pid})`)

      session = {
        game,
        rootPid: pid,
        knownPids: new Set([pid]),
        gameWindow: null,
        windowsBeforeLaunch,
        searchDone: !game.forceFullscreen,
        timers: []
      }

      // 3. On cache le hub
      hubWindow?.hide()
      notify({ running: true, gameId: game.id, message: `${game.name} lancé` })

      // 4. Recherche de la fenêtre + plein écran
      if (game.forceFullscreen) startWindowSearch(session)
      // 5. Surveillance de la fin du jeu
      startProcessWatch(session)
      resolve()
    })
  })
}

/**
 * Cherche la fenêtre du jeu à intervalle régulier et la passe en plein écran.
 *
 * Pourquoi continuer après l'avoir trouvée ? Parce que certains jeux :
 *  - affichent d'abord un splash, puis la vraie fenêtre ;
 *  - se redimensionnent eux-mêmes juste après le démarrage (et remettent leur bordure).
 * On attend donc que la même fenêtre reste en plein écran pendant 5 s.
 */
function startWindowSearch(s: Session): void {
  const startedAt = Date.now()
  let stableSince = 0

  const timer = setInterval(() => {
    if (session !== s) return clearInterval(timer)

    try {
      const found = wm.findGameWindow({
        rootPid: s.rootPid,
        windowsBeforeLaunch: s.windowsBeforeLaunch,
        excludedPids: new Set([process.pid])
      })

      if (found) {
        const { hwnd, pid, title } = found.window
        s.knownPids.add(pid)

        if (hwnd !== s.gameWindow) {
          console.log(`[launcher] Fenêtre trouvée (${found.source}) : "${title}" pid ${pid}`)
          s.gameWindow = hwnd
          stableSince = 0
        }

        if (!wm.isBorderlessFullscreen(hwnd)) {
          wm.makeBorderlessFullscreen(hwnd)
          stableSince = 0
          console.log('[launcher] Plein écran sans bordure appliqué')
        } else if (stableSince === 0) {
          stableSince = Date.now()
        } else if (Date.now() - stableSince >= WINDOW_STABLE_DELAY) {
          console.log('[launcher] Fenêtre stable, fin de la surveillance du plein écran')
          s.searchDone = true
          clearInterval(timer)
          return
        }
      }

      if (Date.now() - startedAt > WINDOW_SEARCH_TIMEOUT) {
        if (!s.gameWindow) console.warn('[launcher] Aucune fenêtre de jeu trouvée après 30 s')
        s.searchDone = true
        clearInterval(timer)
      }
    } catch (error) {
      console.error('[launcher] Erreur pendant la recherche de fenêtre', error)
    }
  }, WINDOW_SEARCH_INTERVAL)

  s.timers.push(timer)
}

/**
 * Vérifie chaque seconde si le jeu tourne encore.
 * Le jeu est considéré "fermé" quand :
 *  - aucun des processus connus (lanceur, enfants, propriétaire de la fenêtre) n'est vivant,
 *  - ET la recherche de fenêtre est terminée (sinon un launcher qui se ferme vite
 *    ferait réapparaître le hub avant que le vrai jeu n'ouvre sa fenêtre).
 * On attend 2 vérifications "mortes" d'affilée pour éviter les faux positifs.
 */
function startProcessWatch(s: Session): void {
  let deadChecks = 0

  const timer = setInterval(() => {
    if (session !== s) return clearInterval(timer)

    const processes = wm.snapshotProcesses()
    // On ajoute les nouveaux descendants du processus lancé
    for (const pid of wm.getProcessTree(s.rootPid, processes)) s.knownPids.add(pid)

    const alive =
      [...s.knownPids].some((pid) => processes.has(pid)) ||
      (s.gameWindow !== null && wm.windowExists(s.gameWindow))

    deadChecks = alive ? 0 : deadChecks + 1
    if (deadChecks >= 2 && s.searchDone) {
      console.log(`[launcher] "${s.game.name}" fermé`)
      endSession()
    }
  }, PROCESS_CHECK_INTERVAL)

  s.timers.push(timer)
}

/** Termine la session : arrête les minuteurs et réaffiche le hub. */
function endSession(message?: string): void {
  if (session) {
    session.timers.forEach((t) => clearInterval(t))
    session = null
  }
  if (hubWindow && !hubWindow.isDestroyed()) {
    hubWindow.show()
    hubWindow.focus()
  }
  notify({ running: false, gameId: null, message })
}

/**
 * Force la fermeture du jeu en cours (raccourci global).
 * On utilise `taskkill /T /F` : /T tue aussi les processus enfants, /F force.
 */
export function killRunningGame(): void {
  const s = session
  if (!s) return
  console.log(`[launcher] Fermeture forcée de "${s.game.name}"`)
  const processes = wm.snapshotProcesses()
  for (const pid of s.knownPids) {
    if (processes.has(pid)) {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], (error) => {
        if (error) console.warn(`[launcher] taskkill ${pid} :`, error.message)
      })
    }
  }
  endSession('Jeu fermé de force')
}
