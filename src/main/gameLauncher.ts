// Lancement d'un jeu + suivi de son exécution.
//
// Déroulé quand on lance un jeu :
//  0. si le jeu a un correctif Flawless Widescreen : on démarre FWS avec le correctif activé (flawless.ts) ;
//  1. on note les fenêtres déjà ouvertes (pour reconnaître la "nouvelle" fenêtre du jeu) ;
//  2. on démarre le .exe (le jeu, son relais, ou Steam). Pour un launcher dont on connaît le vrai jeu,
//     on lance DIRECTEMENT le vrai .exe (pas de clic sur "Jouer") ; si le jeu refuse de démarrer
//     sans son launcher, on ouvre le launcher et on s'en souvient (voir fallbackToLauncher) ;
//  3. le hub RESTE affiché avec l'écran de chargement (phase 'starting') ;
//  4. toutes les 0,5 s, on cherche :
//     - la fenêtre d'un launcher → elle reste DERRIÈRE Gamer Room, dans la barre des tâches : on peut
//       y aller pour cliquer sur "Jouer" (phase 'launcher', voir keepHubInFront) ;
//     - la fenêtre du VRAI jeu → plein écran sans bordure, puis on cache le hub (phase 'playing') ;
//       au premier lancement, on retient quel .exe l'a ouverte (voir launchLearning.ts) ;
//  5. toutes les secondes, on vérifie si le jeu tourne encore ;
//     quand il est fermé, on réaffiche le hub.
//
// Comment on reconnaît la fenêtre du vrai jeu (du plus sûr au moins sûr) :
//  - elle appartient au vrai .exe du jeu (`realExePath`, connu à l'ajout ou appris) ;
//  - jeu Steam : elle appartient à un programme du dossier d'installation du jeu ;
//  - sinon : la plus grande fenêtre du processus lancé ou de ses enfants (comme avant).
//
// Le raccourci global (Ctrl+Alt+F4 par défaut) appelle killRunningGame().

import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Game, RunningState } from '@shared/types'
import { launchedByStore, shouldSkipLauncher } from '@shared/launch'
import * as wm from './windowManager'
import { ensureLaunchInfo, updateGame } from './library'
import { removeRunAsAdmin } from './compatFlags'
import { fixNameIfFromLauncher, isInside, learnFromGameWindow, samePath } from './launchLearning'
import { bringHubToFront, getHub } from './hub'
import { prepareForGame } from './flawless'
import { BATTLE_NET_RETRY_DELAY, ensureBattleNetReady, isBattleNetLaunch } from './pcGames/battleNetLaunch'
import { isKnownLauncherExe } from './knownLaunchers'
import { isRiotLaunch, requestRiotLaunch } from './pcGames/riotLaunch'

// Réglages du suivi (en millisecondes)
const SEARCH_TIMEOUT = 30_000 // jeu "normal" : on cherche la fenêtre pendant 30 s max
const SEARCH_TIMEOUT_LONG = 5 * 60_000 // launcher ou Steam : 5 min (le temps de cliquer sur Jouer, des mises à jour…)
const WINDOW_SEARCH_INTERVAL = 500 // toutes les 0,5 s
const WINDOW_STABLE_DELAY = 5_000 // une fois en plein écran, on surveille encore 5 s
const PROCESS_CHECK_INTERVAL = 1_000 // on vérifie que le jeu tourne toutes les secondes
const MIN_LOADING_TIME = 1_500 // l'écran de chargement reste au moins 1,5 s (évite un clignotement)
const LAUNCHER_CLOSED_DELAY = 15 // launcher fermé sans lancer le jeu : on abandonne après 15 s
const FALLBACK_WINDOW = 30_000 // launcher sauté : si le jeu se ferme dans les 30 s sans fenêtre, on ouvre le launcher

type Phase = NonNullable<RunningState['phase']>

/** Tout ce qu'on sait sur le jeu en cours. */
interface Session {
  game: Game
  /** On a lancé directement le vrai .exe, sans le launcher ? */
  skippedLauncher: boolean
  /** Pid du processus qu'on a lancé nous-mêmes. */
  rootPid: number
  /** Tous les pids "du lancement" qu'on a vus vivants (launcher, enfants…). */
  knownPids: Set<number>
  /** Les pids du vrai jeu (propriétaire de la fenêtre du jeu + ses enfants). */
  gamePids: Set<number>
  /** La fenêtre du jeu, une fois trouvée. */
  gameWindow: wm.Hwnd | null
  /** La dernière fenêtre de launcher mise au premier plan. */
  launcherWindow: wm.Hwnd | null
  /** Dernière fois qu'on a vu une fenêtre de launcher ouverte (0 = jamais). */
  launcherSeenAt: number
  /** Fenêtres de launchers déjà remises derrière Gamer Room (une seule fois chacune, voir keepHubInFront). */
  pushedBack: Set<wm.Hwnd>
  /** Fenêtres présentes avant le lancement. */
  windowsBeforeLaunch: Set<wm.Hwnd>
  /** La recherche de fenêtre est-elle terminée (trouvée et stable, ou délai dépassé) ? */
  searchDone: boolean
  startedAt: number
  phase: Phase
  /** Chemins des .exe déjà lus (lire le chemin d'un processus coûte un peu). */
  paths: Map<number, string | null>
  timers: NodeJS.Timeout[]
}

let session: Session | null = null
/** Préparation avant le jeu (Flawless Widescreen) : le jeu n'est pas encore lancé. */
let preparing: { cancelled: boolean } | null = null
let notify: (state: RunningState) => void = () => {}

/** À appeler une fois au démarrage : on donne une fonction pour prévenir l'interface. */
export function initGameLauncher(onState: (state: RunningState) => void): void {
  notify = onState
}

export function isGameRunning(): boolean {
  return session !== null || preparing !== null
}

/** Le jeu en cours, seulement quand on est vraiment « en jeu » (hub caché), sinon null. Sert au menu en jeu. */
export function getPlayingGame(): { game: Game; gameWindow: wm.Hwnd | null; startedAt: number } | null {
  if (!session || session.phase !== 'playing') return null
  return { game: session.game, gameWindow: session.gameWindow, startedAt: session.startedAt }
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

/** Le jeu passe-t-il par un intermédiaire qui peut prendre du temps (launcher, Steam) ? */
function isSlowStart(game: Game): boolean {
  return game.launchKind === 'launcher' || launchedByStore(game)
}

/** Prévient l'interface de l'état du lancement. */
function sendState(s: Session, extra: Partial<RunningState> = {}): void {
  notify({ running: true, gameId: s.game.id, phase: s.phase, ...extra })
}

/**
 * Lance un jeu. Renvoie une promesse qui se résout dès que le processus a démarré.
 * Si le jeu a un correctif Flawless Widescreen, on démarre d'abord FWS avec le correctif activé
 * (voir flawless.ts) ; en cas de souci, le jeu se lance quand même, sans correctif.
 */
export async function launchGame(gameToLaunch: Game): Promise<void> {
  if (session || preparing) throw new Error('Un jeu est déjà en cours.')
  const prep = { cancelled: false }
  preparing = prep
  let warning: string | null
  try {
    warning = await prepareForGame(
      gameToLaunch,
      // L'écran de chargement s'affiche déjà pendant la préparation de Flawless Widescreen
      () => notify({ running: true, gameId: gameToLaunch.id, phase: 'flawless' }),
      () => prep.cancelled
    )
    // Jeu Battle.net : Battle.net doit être ouvert pour que la commande lance vraiment le jeu
    if (!prep.cancelled) {
      await ensureBattleNetReady(
        gameToLaunch,
        () => notify({ running: true, gameId: gameToLaunch.id, phase: 'battlenet' }),
        () => prep.cancelled
      )
    }
  } finally {
    preparing = null
  }
  if (prep.cancelled) return // « Annuler » cliqué pendant la préparation
  await startGame(gameToLaunch)
  if (warning && session) sendState(session, { message: warning })
  if (session && isBattleNetLaunch(gameToLaunch)) scheduleBattleNetRetry(session)
  // Jeu Riot : Riot ne lance plus le jeu tout seul, on le lui demande (voir riotLaunch.ts)
  const s = session as Session | null
  if (s && isRiotLaunch(gameToLaunch)) {
    void requestRiotLaunch(gameToLaunch, () => session !== s || s.gameWindow !== null || gameProcessStarted(s, false))
  }
}

/**
 * Jeu Battle.net : si le jeu n'a toujours pas démarré 20 s après la commande de lancement
 * (Battle.net encore en train de se connecter…), on renvoie la commande une fois.
 */
function scheduleBattleNetRetry(s: Session): void {
  const timer = setTimeout(() => {
    if (session !== s || s.gameWindow || gameProcessStarted(s)) return
    console.log("[battle.net] Le jeu n'a pas démarré : on renvoie la commande de lancement")
    startProcess(s.game.exePath, s.game.args, s.game.workingDir).once('error', (error) =>
      console.warn('[battle.net] Nouvel envoi impossible', error.message)
    )
  }, BATTLE_NET_RETRY_DELAY)
  s.timers.push(timer)
}

/** Une fenêtre de launcher était-elle encore ouverte il y a moins de 3 s ? (voir startWindowSearch) */
function launcherOpen(s: Session): boolean {
  return s.launcherSeenAt > 0 && Date.now() - s.launcherSeenAt < 3_000
}

/**
 * Un programme du dossier du jeu tourne-t-il déjà (le jeu démarre, même sans fenêtre pour l'instant) ?
 * `includeLaunchers` = false : on ne compte pas les launchers connus (ex. le salon de League of Legends).
 */
function gameProcessStarted(s: Session, includeLaunchers = true): boolean {
  const folder = s.game.gameFolder
  if (!folder) return false
  for (const process of wm.snapshotProcesses().values()) {
    const path = pathOf(s, process.pid)
    if (path && isInside(path, folder) && (includeLaunchers || !isKnownLauncherExe(path))) return true
  }
  return false
}

/** Démarre le jeu lui-même (après la préparation éventuelle de Flawless Widescreen). */
function startGame(gameToLaunch: Game): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session) {
      reject(new Error('Un jeu est déjà en cours.'))
      return
    }
    if (!existsSync(gameToLaunch.exePath)) {
      reject(new Error(`Fichier introuvable : ${gameToLaunch.exePath}`))
      return
    }

    // Jeux ajoutés avant la détection des launchers : on la fait maintenant
    const game = ensureLaunchInfo(gameToLaunch)

    // 1. Fenêtres déjà présentes
    const windowsBeforeLaunch = new Set(wm.listAllWindowHandles())

    // 2. Démarrage du jeu : directement le vrai .exe si on saute le launcher (Cyberpunk), sinon le .exe ajouté
    const skip = shouldSkipLauncher(game) && existsSync(game.realExePath!)
    // L'option « Exécuter en tant qu'administrateur » peut avoir été remise (par un launcher, un outil…) :
    // on la retire juste avant de lancer, sinon Windows refuse le lancement direct.
    if (skip && removeRunAsAdmin(game.realExePath)) {
      console.log('[launcher] Option administrateur retrouvée sur le jeu et retirée avant le lancement')
    }
    const child = skip ? startProcess(game.realExePath!, '', dirname(game.realExePath!)) : startProcess(game.exePath, game.args, game.workingDir)

    child.once('error', (error) => {
      // Le vrai .exe demande les droits administrateur (EACCES) : Windows refuse de le lancer
      // sans la fenêtre "Contrôle de compte d'utilisateur". On passe alors par le launcher, pour cette fois
      // seulement (si on retire l'option "Exécuter en tant qu'administrateur", le lancement direct remarchera).
      if (skip && (error as NodeJS.ErrnoException).code === 'EACCES') {
        console.warn(`[launcher] ${game.realExePath} demande les droits administrateur : on passe par le launcher`)
        startGame({ ...game, skipLauncher: false }).then(resolve, reject)
        return
      }
      endSession('Erreur au lancement')
      reject(new Error(`Impossible de lancer le jeu : ${error.message}`))
    })

    child.once('spawn', () => {
      const pid = child.pid!
      console.log(
        `[launcher] "${game.name}" démarré (pid ${pid}, type : ${game.launchKind}${skip ? ', launcher sauté' : ''})`
      )

      const s: Session = {
        skippedLauncher: skip,
        game,
        rootPid: pid,
        knownPids: new Set([pid]),
        gamePids: new Set(),
        gameWindow: null,
        launcherWindow: null,
        launcherSeenAt: 0,
        pushedBack: new Set(),
        windowsBeforeLaunch,
        searchDone: false,
        startedAt: Date.now(),
        phase: 'starting',
        paths: new Map(),
        timers: []
      }
      session = s

      // 3. Le hub reste affiché : l'interface montre l'écran de chargement
      sendState(s, { game })

      // Le jeu porte encore le nom de son launcher ("Longshot") : on cherche son vrai nom tout de suite
      fixNameIfFromLauncher(game.id).then((updated) => {
        if (updated && session === s) {
          s.game = updated
          sendState(s, { game: updated })
        }
      })

      // 4. Recherche des fenêtres (launcher puis jeu)
      startWindowSearch(s)
      // 5. Surveillance de la fin du jeu
      startProcessWatch(s)
      resolve()
    })
  })
}

/**
 * Démarre un programme.
 * detached + unref : le jeu vit sa vie, même si le hub plante.
 */
function startProcess(exe: string, args: string, cwd: string): ChildProcess {
  const child = spawn(exe, parseArgs(args), {
    cwd: existsSync(cwd) ? cwd : undefined,
    detached: true,
    stdio: 'ignore'
  })
  child.once('spawn', () => child.unref())
  return child
}

/**
 * Le vrai .exe lancé directement s'est fermé tout de suite sans ouvrir de fenêtre :
 * ce jeu a besoin de son launcher. On ouvre le launcher, et on s'en souvient pour la prochaine fois.
 */
function fallbackToLauncher(s: Session): void {
  console.log(`[launcher] "${s.game.name}" refuse de démarrer sans son launcher : on ouvre le launcher`)
  s.skippedLauncher = false
  s.game = updateGame(s.game.id, { skipLauncher: false })
  const child = startProcess(s.game.exePath, s.game.args, s.game.workingDir)
  child.once('error', () => endSession('Impossible d\'ouvrir le launcher'))
  child.once('spawn', () => {
    if (session !== s) return
    s.rootPid = child.pid!
    s.knownPids.add(child.pid!)
    s.phase = 'starting'
    sendState(s, { game: s.game, message: 'Ce jeu a besoin de son launcher : ouverture du launcher' })
  })
}

/** Chemin du .exe d'un processus (avec cache). */
function pathOf(s: Session, pid: number): string | null {
  if (!s.paths.has(pid)) s.paths.set(pid, wm.getProcessPath(pid))
  return s.paths.get(pid) ?? null
}

const area = (w: wm.WindowInfo): number => (w.rect.right - w.rect.left) * (w.rect.bottom - w.rect.top)

/** Une fenêtre qui couvre presque tout l'écran : c'est un jeu, pas un petit launcher. */
function coversScreen(w: wm.WindowInfo): boolean {
  const monitor = wm.getMonitorRectForWindow(w.hwnd)
  if (!monitor) return false
  return area(w) >= (monitor.right - monitor.left) * (monitor.bottom - monitor.top) * 0.7
}

/**
 * Regarde les fenêtres ouvertes et renvoie :
 *  - `game`     : la fenêtre du vrai jeu, ou null ;
 *  - `launcher` : la fenêtre d'un launcher (à mettre devant l'écran de chargement), ou null.
 */
function findWindows(s: Session): { game: wm.WindowInfo | null; launcher: wm.WindowInfo | null } {
  const g = s.game
  const windows = wm.listAppWindows().filter((w) => w.pid !== process.pid)
  const tree = wm.getProcessTree(s.rootPid, undefined, launchTime(s))
  const biggestFirst = (list: wm.WindowInfo[]): wm.WindowInfo[] => list.sort((a, b) => area(b) - area(a))

  // Jeu Steam, Epic, Battle.net ou Riot : dans le dossier du jeu, ces programmes sont des launchers, pas le jeu :
  //  - un launcher connu (voir knownLaunchers.ts), ex. le salon de League of Legends (LeagueClientUx.exe) ;
  //  - un programme dont le nom contient "launcher" (ex. le REDlauncher de The Witcher 3)… sauf s'il couvre l'écran.
  const inSteamFolder = (w: wm.WindowInfo): boolean => {
    const path = pathOf(s, w.pid)
    return launchedByStore(g) && !!path && !!g.gameFolder && isInside(path, g.gameFolder)
  }
  const isSteamLauncher = (w: wm.WindowInfo): boolean => {
    const path = pathOf(s, w.pid) ?? ''
    return inSteamFolder(w) && (isKnownLauncherExe(path) || (/launch/i.test(path) && !coversScreen(w)))
  }

  // 1. Fenêtres du vrai jeu, reconnues par le chemin de leur .exe
  const isRealGame = (w: wm.WindowInfo): boolean =>
    samePath(pathOf(s, w.pid), g.realExePath) || (inSteamFolder(w) && !isSteamLauncher(w))
  let games = windows.filter((w) => isRealGame(w) && wm.looksLikeMainWindow(w))

  // 2. Sinon, les fenêtres du processus lancé et de ses enfants
  if (games.length === 0 && !launchedByStore(g)) {
    const fromTree = windows.filter((w) => tree.has(w.pid) && wm.looksLikeMainWindow(w))
    if (g.launchKind === 'launcher') {
      // Launcher : ses propres fenêtres ne sont pas le jeu… sauf si elles couvrent l'écran
      // (au cas où la détection s'est trompée et que ce "launcher" est le jeu lui-même)
      games = fromTree.filter((w) => !samePath(pathOf(s, w.pid), g.exePath) || coversScreen(w))
    } else {
      games = fromTree
    }

    // 3. Dernier recours (jeu ou relais) : une nouvelle fenêtre au premier plan
    if (games.length === 0 && g.launchKind !== 'launcher') {
      const foreground = wm.getForegroundWindow()
      const info = windows.find((w) => w.hwnd === foreground)
      if (info && !s.windowsBeforeLaunch.has(info.hwnd) && wm.looksLikeMainWindow(info)) games = [info]
    }
  }

  const game = biggestFirst(games)[0] ?? null
  // Fenêtre de launcher : une fenêtre du processus lancé (ou de ses enfants) qui n'est pas le jeu,
  // ou le launcher de l'éditeur d'un jeu Steam
  const launchers = windows.filter(
    (w) => w !== game && ((g.launchKind === 'launcher' && tree.has(w.pid)) || isSteamLauncher(w))
  )
  return { game, launcher: biggestFirst(launchers)[0] ?? null }
}

/**
 * Pendant le lancement, Gamer Room reste la fenêtre visible : si un launcher passe au premier plan
 * (Riot Client, Battle.net, Epic, Steam, le launcher de l'éditeur, le salon de League of Legends…),
 * on remet Gamer Room devant. Le launcher reste ouvert derrière, dans la barre des tâches.
 *
 * Une seule fois par fenêtre : si le joueur va lui-même sur le launcher (barre des tâches) pour cliquer
 * sur « Jouer », on le laisse faire.
 *
 * Ce qui compte comme launcher : la fenêtre de launcher trouvée par findWindows, ou une fenêtre d'un
 * launcher connu (voir knownLaunchers.ts), où qu'il soit installé.
 */
function keepHubInFront(s: Session, launcher: wm.WindowInfo | null): void {
  const foreground = wm.getForegroundWindow()
  if (!foreground || s.pushedBack.has(foreground)) return
  const pid = wm.getWindowPid(foreground)
  if (pid === process.pid) return // c'est déjà Gamer Room
  const isLauncher = foreground === launcher?.hwnd || isKnownLauncherExe(pathOf(s, pid))
  if (!isLauncher) return
  s.pushedBack.add(foreground)
  console.log(`[launcher] Launcher au premier plan (${pathOf(s, pid) ?? pid}) : Gamer Room repasse devant`)
  bringHubToFront()
}

/** Cache le hub une fois l'écran de chargement resté affiché assez longtemps. */
function hideHubSoon(s: Session): void {
  const wait = Math.max(0, MIN_LOADING_TIME - (Date.now() - s.startedAt))
  const timer = setTimeout(() => {
    if (session === s) getHub()?.hide()
  }, wait)
  s.timers.push(timer)
}

/** La fenêtre du jeu vient d'être trouvée : on passe en phase "en jeu". */
function onGameWindowFound(s: Session, win: wm.WindowInfo): void {
  s.gameWindow = win.hwnd
  for (const pid of wm.getProcessTree(win.pid, undefined, launchTime(s))) s.gamePids.add(pid)

  if (s.phase !== 'playing') {
    s.phase = 'playing'
    hideHubSoon(s)
    sendState(s, { message: `${s.game.name} lancé` })

    // Premier lancement : on retient le vrai .exe, et on corrige le nom / la jaquette si besoin
    learnFromGameWindow(s.game.id, pathOf(s, win.pid)).then((updated) => {
      if (updated && session === s) {
        s.game = updated
        sendState(s, { game: updated })
      }
    })
  }
}

/**
 * Cherche les fenêtres à intervalle régulier.
 *
 * Pourquoi continuer après avoir trouvé le jeu ? Parce que certains jeux :
 *  - affichent d'abord un splash, puis la vraie fenêtre ;
 *  - se redimensionnent eux-mêmes juste après le démarrage (et remettent leur bordure).
 * On attend donc que la même fenêtre reste en plein écran pendant 5 s.
 */
function startWindowSearch(s: Session): void {
  const timeout = isSlowStart(s.game) ? SEARCH_TIMEOUT_LONG : SEARCH_TIMEOUT
  let stableSince = 0

  const timer = setInterval(() => {
    if (session !== s) return clearInterval(timer)

    try {
      const found = findWindows(s)

      // Un launcher est ouvert (ex. le salon de League of Legends, où l'on attend une partie) :
      // on continue d'attendre le jeu tant qu'il reste ouvert (le délai repart de zéro)
      if (found.launcher && !found.game) s.launcherSeenAt = Date.now()

      // Fenêtre de launcher : on la retient (l'écran de chargement indique qu'il faut peut-être y cliquer sur « Jouer »)
      if (!found.game && found.launcher && found.launcher.hwnd !== s.launcherWindow) {
        console.log(`[launcher] Fenêtre de launcher : "${found.launcher.title}"`)
        s.launcherWindow = found.launcher.hwnd
        if (s.phase === 'starting') {
          s.phase = 'launcher'
          sendState(s)
        }
      }

      // Un launcher passe devant Gamer Room : on le remet derrière (il reste dans la barre des tâches)
      if (!found.game) keepHubInFront(s, found.launcher)

      if (found.game) {
        const { hwnd, pid, title } = found.game
        s.knownPids.add(pid)
        if (hwnd !== s.gameWindow) {
          console.log(`[launcher] Fenêtre du jeu trouvée : "${title}" pid ${pid}`)
          onGameWindowFound(s, found.game)
          stableSince = 0
        }

        if (!s.game.forceFullscreen) {
          // Pas de plein écran forcé : il suffisait de trouver la fenêtre pour cacher le hub
          s.searchDone = true
          clearInterval(timer)
          return
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

      if (Date.now() - Math.max(s.startedAt, s.launcherSeenAt) > timeout) {
        if (!s.gameWindow) {
          console.warn(`[launcher] Aucune fenêtre de jeu trouvée après ${timeout / 1000} s`)
          // On cache quand même le hub : le jeu est peut-être là, mais pas reconnu
          if (s.phase !== 'playing') {
            s.phase = 'playing'
            getHub()?.hide()
            sendState(s)
          }
        }
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
 *  - Fenêtre du jeu trouvée : le jeu est "fermé" quand sa fenêtre et ses processus ont disparu
 *    (un launcher resté ouvert, ou Steam, ne compte pas).
 *  - Pas encore de fenêtre : on attend la fin de la recherche, sauf si un launcher a été fermé
 *    sans lancer le jeu (rien ne tourne depuis 15 s).
 * On attend 2 vérifications "mortes" d'affilée pour éviter les faux positifs.
 */
function startProcessWatch(s: Session): void {
  let deadChecks = 0

  const timer = setInterval(() => {
    if (session !== s) return clearInterval(timer)

    const processes = wm.snapshotProcesses()
    // On ajoute les nouveaux descendants du processus lancé, et ceux du jeu
    if (!launchedByStore(s.game)) for (const pid of wm.getProcessTree(s.rootPid, processes, launchTime(s))) s.knownPids.add(pid)
    for (const pid of [...s.gamePids]) for (const child of wm.getProcessTree(pid, processes, launchTime(s))) s.gamePids.add(child)

    let alive: boolean
    if (s.gameWindow) {
      const gameAlive = wm.windowExists(s.gameWindow) || [...s.gamePids].some((pid) => processes.has(pid))
      // Jeu "normal" ou relais : on garde l'ancienne règle (tous les processus du lancement comptent)
      const launchAlive = !isSlowStart(s.game) && [...s.knownPids].some((pid) => processes.has(pid))
      alive = gameAlive || launchAlive
    } else if (launchedByStore(s.game)) {
      // Jeu lancé par un magasin, pas encore de fenêtre : le programme qu'on a lancé (Steam, Riot Client…) peut
      // rester ouvert sans le jeu. On regarde donc plutôt si le launcher du jeu (ex. le salon de League of Legends)
      // est encore ouvert, ou si un programme du dossier du jeu tourne.
      alive = launcherOpen(s) || gameProcessStarted(s)
    } else {
      alive = [...s.knownPids].some((pid) => processes.has(pid))
    }

    deadChecks = alive ? 0 : deadChecks + 1

    // Launcher sauté, mais le jeu s'est fermé en moins de 30 s sans fenêtre : on repasse par le launcher
    if (s.skippedLauncher && !s.gameWindow && deadChecks >= 3 && Date.now() - s.startedAt < FALLBACK_WINDOW) {
      deadChecks = 0
      fallbackToLauncher(s)
      return
    }

    // Launcher fermé sans lancer le jeu (launcher de l'éditeur, ou salon d'un jeu de magasin comme League of Legends)
    const hadLauncher = s.game.launchKind === 'launcher' || (launchedByStore(s.game) && s.launcherWindow !== null)
    const launcherGaveUp = hadLauncher && !s.gameWindow && deadChecks >= LAUNCHER_CLOSED_DELAY
    if ((deadChecks >= 2 && (s.searchDone || s.gameWindow)) || launcherGaveUp) {
      console.log(`[launcher] "${s.game.name}" fermé`)
      endSession(launcherGaveUp ? 'Launcher fermé sans lancer le jeu' : undefined)
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
  const hub = getHub()
  if (hub) {
    hub.show()
    hub.focus()
  }
  notify({ running: false, gameId: null, message })
}

/**
 * Force la fermeture du jeu en cours (raccourci global, ou bouton "Annuler" de l'écran de chargement).
 * On utilise `taskkill /F` (/F = forcer) sur chaque programme du jeu, un par un.
 * Pour un jeu Steam, on ne ferme jamais Steam lui-même : seulement le jeu.
 *
 * Sécurité (un « vieux » programme avait été pris pour un enfant du jeu et l'Explorateur Windows fermé,
 * à cause des numéros de programme que Windows réutilise, voir getProcessTree) :
 *  - plus de `taskkill /T` : il cherche lui-même les enfants par numéro, sans vérifier les heures de démarrage.
 *    On ferme seulement la liste qu'on a vérifiée nous-mêmes (recalculée juste avant) ;
 *  - on ne ferme jamais un programme démarré avant le lancement du jeu ;
 *  - on ne ferme jamais les programmes vitaux de Windows ni Steam (wm.isProtectedProcess).
 */
export function killRunningGame(): void {
  // Annulé pendant la préparation de Flawless Widescreen : le jeu ne sera pas lancé
  if (preparing) {
    preparing.cancelled = true
    notify({ running: false, gameId: null, message: 'Lancement annulé' })
    return
  }
  const s = session
  if (!s) return
  console.log(`[launcher] Fermeture forcée de "${s.game.name}"`)
  const processes = wm.snapshotProcesses()
  const roots = launchedByStore(s.game) ? s.gamePids : new Set([...s.knownPids, ...s.gamePids])
  // On ajoute les enfants apparus depuis la dernière vérification (même règles que getProcessTree)
  const targets = new Set<number>()
  for (const pid of roots) for (const child of wm.getProcessTree(pid, processes, launchTime(s))) targets.add(child)

  for (const pid of targets) {
    const info = processes.get(pid)
    if (!info || pid === process.pid) continue
    if (wm.isProtectedProcess(info.exeName)) {
      console.warn(`[launcher] ${info.exeName} (pid ${pid}) est protégé : on ne le ferme pas`)
      continue
    }
    const start = wm.getProcessStartTime(pid)
    if (start !== null && start < launchTime(s)) {
      console.warn(`[launcher] ${info.exeName} (pid ${pid}) tournait avant le jeu : on ne le ferme pas`)
      continue
    }
    execFile('taskkill', ['/PID', String(pid), '/F'], (error) => {
      if (error) console.warn(`[launcher] taskkill ${pid} :`, error.message)
    })
  }
  endSession('Jeu fermé de force')
}

/**
 * Heure à partir de laquelle un programme peut faire partie du jeu : le lancement, moins 10 s de marge
 * (le .exe démarre juste avant qu'on note l'heure du lancement).
 */
function launchTime(s: Session): number {
  return s.startedAt - 10_000
}
