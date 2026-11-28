/*
 * ============================================================================
 *  windowManager.ts — Tout le code "bas niveau" Windows (API Win32) est ICI.
 * ============================================================================
 *
 *  À quoi sert ce fichier ?
 *  ------------------------
 *  1. Lister les processus (pour retrouver les "enfants" d'un launcher).
 *  2. Lister les fenêtres ouvertes et trouver celle du jeu.
 *  3. Passer une fenêtre en "plein écran fenêtré sans bordure" (borderless) :
 *       - on retire la bordure et la barre de titre,
 *       - on la redimensionne à la taille COMPLÈTE de l'écran où elle se trouve,
 *       - on la met au premier plan.
 *
 *  Comment Node.js parle à Windows ?
 *  ---------------------------------
 *  Avec la bibliothèque `koffi` (FFI = "Foreign Function Interface") : elle
 *  permet d'appeler directement des fonctions C de Windows (user32.dll,
 *  kernel32.dll) depuis JavaScript, sans compiler de code C++.
 *
 *  Important (koffi 3) :
 *   - un handle de fenêtre (HWND) est un `bigint` (ex. 103483298n) ;
 *   - un pointeur nul vaut `null`.
 *
 *  Ce fichier n'importe RIEN d'Electron : il est testable avec Node seul.
 */

import koffi from 'koffi'

// ----------------------------------------------------------------------------
//  1. Chargement des DLL Windows
// ----------------------------------------------------------------------------

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

// ----------------------------------------------------------------------------
//  2. Structures C utilisées par les fonctions Windows
// ----------------------------------------------------------------------------

/** Un rectangle en pixels (coordonnées écran). */
const RECT = koffi.struct('RECT', {
  left: 'int32',
  top: 'int32',
  right: 'int32',
  bottom: 'int32'
})

/** Infos sur un moniteur : sa zone totale (rcMonitor) et sa zone sans la barre des tâches (rcWork). */
const MONITORINFO = koffi.struct('MONITORINFO', {
  cbSize: 'uint32',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32'
})

/** Une ligne de la "photo" des processus (CreateToolhelp32Snapshot). */
const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
  dwSize: 'uint32',
  cntUsage: 'uint32',
  th32ProcessID: 'uint32',
  th32DefaultHeapID: 'uintptr_t',
  th32ModuleID: 'uint32',
  cntThreads: 'uint32',
  th32ParentProcessID: 'uint32',
  pcPriClassBase: 'int32',
  dwFlags: 'uint32',
  szExeFile: koffi.array('char16_t', 260, 'String')
})

/** Type de la fonction "callback" appelée par EnumWindows pour chaque fenêtre. */
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)')

// ----------------------------------------------------------------------------
//  3. Fonctions Windows qu'on utilise (déclarées avec leur "signature" C)
// ----------------------------------------------------------------------------

// --- Fenêtres (user32.dll) ---
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)')
const GetWindowThreadProcessId = user32.func(
  'uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)'
)
const IsWindow = user32.func('bool __stdcall IsWindow(void *hwnd)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)')
const IsIconic = user32.func('bool __stdcall IsIconic(void *hwnd)') // minimisée ?
const IsZoomed = user32.func('bool __stdcall IsZoomed(void *hwnd)') // maximisée ?
const GetWindow = user32.func('void * __stdcall GetWindow(void *hwnd, uint32 cmd)')
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int index)')
const SetWindowLongPtrW = user32.func(
  'intptr_t __stdcall SetWindowLongPtrW(void *hwnd, int index, intptr_t value)'
)
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ RECT *rect)')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint8_t *buf, int max)')
const MonitorFromWindow = user32.func('void * __stdcall MonitorFromWindow(void *hwnd, uint32 flags)')
const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(void *hmon, _Inout_ MONITORINFO *info)')
const SetWindowPos = user32.func(
  'bool __stdcall SetWindowPos(void *hwnd, void *after, int x, int y, int cx, int cy, uint32 flags)'
)
const ShowWindow = user32.func('bool __stdcall ShowWindow(void *hwnd, int cmd)')
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void *hwnd)')
const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()')
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(void *hwnd)')
const keybd_event = user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)')

// --- Processus (kernel32.dll) ---
const CreateToolhelp32Snapshot = kernel32.func('void * __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)')
const Process32FirstW = kernel32.func('bool __stdcall Process32FirstW(void *snap, _Inout_ PROCESSENTRY32W *entry)')
const Process32NextW = kernel32.func('bool __stdcall Process32NextW(void *snap, _Inout_ PROCESSENTRY32W *entry)')
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *handle)')
const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)')
const GetProcessTimes = kernel32.func(
  'bool __stdcall GetProcessTimes(void *process, _Out_ uint64 *creation, _Out_ uint64 *exit, _Out_ uint64 *kernel, _Out_ uint64 *user)'
)
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(void *process, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)'
)

// ----------------------------------------------------------------------------
//  4. Constantes Windows (valeurs tirées de la documentation Microsoft)
// ----------------------------------------------------------------------------

const GWL_STYLE = -16 // index pour lire/écrire le "style" d'une fenêtre
const GWL_EXSTYLE = -20 // index pour le "style étendu"
const GW_OWNER = 4 // GetWindow : récupérer la fenêtre propriétaire

// Styles de fenêtre
const WS_CAPTION = 0x00c00000 // barre de titre (+ bordure fine)
const WS_THICKFRAME = 0x00040000 // bordure redimensionnable
const WS_MINIMIZEBOX = 0x00020000
const WS_MAXIMIZEBOX = 0x00010000
const WS_SYSMENU = 0x00080000 // menu système (icône + croix)

// Styles étendus
const WS_EX_DLGMODALFRAME = 0x00000001
const WS_EX_TOOLWINDOW = 0x00000080 // petites fenêtres outils (à ignorer)
const WS_EX_WINDOWEDGE = 0x00000100
const WS_EX_CLIENTEDGE = 0x00000200
const WS_EX_STATICEDGE = 0x00020000

// SetWindowPos
const SWP_NOOWNERZORDER = 0x0200
const SWP_FRAMECHANGED = 0x0020 // "recalcule la bordure" (obligatoire après un changement de style)
const SWP_SHOWWINDOW = 0x0040

const MONITOR_DEFAULTTONEAREST = 2
const SW_RESTORE = 9
const TH32CS_SNAPPROCESS = 0x2
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000 // droit minimal pour lire le chemin d'un processus
const VK_MENU = 0x12 // touche Alt
const KEYEVENTF_KEYUP = 0x2

// ----------------------------------------------------------------------------
//  5. Types exposés au reste de l'application
// ----------------------------------------------------------------------------

/** Un handle de fenêtre Windows (HWND). Avec koffi 3, c'est un bigint. */
export type Hwnd = bigint

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ProcessInfo {
  pid: number
  parentPid: number
  exeName: string
}

export interface WindowInfo {
  hwnd: Hwnd
  pid: number
  title: string
  rect: Rect
  style: number
  exStyle: number
}

// ----------------------------------------------------------------------------
//  6. Processus
// ----------------------------------------------------------------------------

/**
 * Prend une "photo" de tous les processus en cours.
 * Renvoie une Map pid -> infos (pid du parent, nom de l'exe).
 * Rapide (quelques millisecondes), on peut l'appeler souvent.
 */
export function snapshotProcesses(): Map<number, ProcessInfo> {
  const result = new Map<number, ProcessInfo>()
  const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
  // INVALID_HANDLE_VALUE vaut -1, soit 0xFFFFFFFFFFFFFFFF en pointeur 64 bits.
  if (!snap || snap === 0xffffffffffffffffn) return result
  try {
    const entry: Record<string, unknown> = { dwSize: koffi.sizeof(PROCESSENTRY32W) }
    if (Process32FirstW(snap, entry)) {
      do {
        const pid = entry.th32ProcessID as number
        result.set(pid, {
          pid,
          parentPid: entry.th32ParentProcessID as number,
          exeName: entry.szExeFile as string
        })
      } while (Process32NextW(snap, entry))
    }
  } finally {
    CloseHandle(snap)
  }
  return result
}

/**
 * Renvoie le pid racine + tous ses descendants (enfants, petits-enfants…).
 * Utile pour les jeux lancés via un "launcher" qui démarre un autre processus.
 * Ça marche même si le launcher s'est déjà fermé : ses enfants gardent
 * son pid comme "parentPid".
 *
 * ⚠️ Piège : Windows RÉUTILISE les numéros (pid) des programmes fermés. Un vieux programme dont le
 * parent est fermé depuis longtemps (l'Explorateur Windows, par exemple) peut donc avoir pour
 * "parentPid" le numéro qu'a reçu plus tard notre jeu. Pour ne pas le prendre pour un enfant du jeu :
 *  - un enfant doit avoir démarré APRÈS son parent ;
 *  - `startedAfter` (heure, comme Date.now()) : on ignore tout programme démarré avant (ex. avant le
 *    lancement du jeu). Indispensable quand le parent est déjà fermé (on ne connaît plus son heure).
 */
export function getProcessTree(
  rootPid: number,
  processes = snapshotProcesses(),
  startedAfter?: number
): Set<number> {
  // On construit une table parent -> enfants
  const children = new Map<number, number[]>()
  for (const p of processes.values()) {
    if (p.pid === p.parentPid) continue // sécurité : le processus "Idle" est son propre parent
    const list = children.get(p.parentPid) ?? []
    list.push(p.pid)
    children.set(p.parentPid, list)
  }
  // Heures de démarrage, lues seulement pour les programmes qu'on examine
  const startTimes = new Map<number, number | null>()
  const startOf = (pid: number): number | null => {
    if (!startTimes.has(pid)) startTimes.set(pid, getProcessStartTime(pid))
    return startTimes.get(pid) ?? null
  }

  // Parcours en largeur à partir de la racine
  const tree = new Set<number>([rootPid])
  const queue = [rootPid]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const child of children.get(current) ?? []) {
      if (tree.has(child)) continue
      const childStart = startOf(child)
      const parentStart = processes.has(current) ? startOf(current) : null
      // Démarré avant son "parent" ou avant le lancement : ce n'est pas un vrai enfant (numéro réutilisé)
      if (childStart !== null && parentStart !== null && childStart < parentStart) continue
      if (childStart !== null && startedAfter !== undefined && childStart < startedAfter) continue
      tree.add(child)
      queue.push(child)
    }
  }
  return tree
}

/**
 * Heure de démarrage d'un processus (millisecondes, comme Date.now()), ou null si Windows refuse.
 * Windows la donne en "FILETIME" : nombre de 100 nanosecondes depuis le 1er janvier 1601.
 */
export function getProcessStartTime(pid: number): number | null {
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (!handle) return null
  try {
    const creation = [0n]
    const ignored = [0n]
    if (!GetProcessTimes(handle, creation, ignored, ignored, ignored)) return null
    return Number(BigInt(creation[0]) / 10_000n) - 11_644_473_600_000 // 1601 → 1970
  } finally {
    CloseHandle(handle)
  }
}

/**
 * Programmes qu'on ne ferme JAMAIS, même s'ils semblent faire partie du jeu :
 * le cœur de Windows (bureau, barre des tâches…) et Steam.
 */
const PROTECTED_EXES = new Set([
  'explorer.exe',
  'dwm.exe',
  'csrss.exe',
  'winlogon.exe',
  'wininit.exe',
  'services.exe',
  'lsass.exe',
  'smss.exe',
  'svchost.exe',
  'sihost.exe',
  'taskhostw.exe',
  'ctfmon.exe',
  'fontdrvhost.exe',
  'runtimebroker.exe',
  'searchhost.exe',
  'startmenuexperiencehost.exe',
  'shellexperiencehost.exe',
  'textinputhost.exe',
  'applicationframehost.exe',
  'steam.exe',
  'steamwebhelper.exe',
  'steamservice.exe'
])

/** Ce programme est-il protégé (jamais fermé de force par Gamer Room) ? */
export function isProtectedProcess(exeName: string): boolean {
  return PROTECTED_EXES.has(exeName.toLowerCase())
}

/**
 * Chemin complet du .exe d'un processus (ex. "D:\jeux\Cyberpunk 2077\bin\x64\Cyberpunk2077.exe"),
 * ou null si Windows refuse (processus système, ou déjà fermé).
 * Sert à reconnaître la fenêtre du vrai jeu quand il est lancé par un launcher ou par Steam.
 */
export function getProcessPath(pid: number): string | null {
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (!handle) return null
  try {
    const buffer = Buffer.alloc(2048) // 1024 caractères UTF-16
    const size = [1024]
    if (!QueryFullProcessImageNameW(handle, 0, buffer, size)) return null
    return buffer.toString('utf16le', 0, size[0] * 2)
  } finally {
    CloseHandle(handle)
  }
}

// ----------------------------------------------------------------------------
//  7. Fenêtres : lecture d'informations
// ----------------------------------------------------------------------------

/** Lit le style d'une fenêtre sous forme de nombre 32 bits non signé. */
function getStyle(hwnd: Hwnd): number {
  return Number(GetWindowLongPtrW(hwnd, GWL_STYLE)) >>> 0
}

function getExStyle(hwnd: Hwnd): number {
  return Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) >>> 0
}

function getWindowTitle(hwnd: Hwnd): string {
  const buffer = Buffer.alloc(512) // 256 caractères UTF-16
  const length = GetWindowTextW(hwnd, buffer, 256)
  return buffer.toString('utf16le', 0, length * 2)
}

function getWindowRect(hwnd: Hwnd): Rect {
  const rect = { left: 0, top: 0, right: 0, bottom: 0 }
  GetWindowRect(hwnd, rect)
  return rect
}

/** Pid du processus propriétaire d'une fenêtre. */
export function getWindowPid(hwnd: Hwnd): number {
  const pid = [0]
  GetWindowThreadProcessId(hwnd, pid)
  return pid[0]
}

/** Infos complètes sur une fenêtre. */
export function getWindowInfo(hwnd: Hwnd): WindowInfo {
  return {
    hwnd,
    pid: getWindowPid(hwnd),
    title: getWindowTitle(hwnd),
    rect: getWindowRect(hwnd),
    style: getStyle(hwnd),
    exStyle: getExStyle(hwnd)
  }
}

/** Liste TOUS les handles de fenêtres "de premier niveau" (visibles ou non). */
export function listAllWindowHandles(): Hwnd[] {
  const handles: Hwnd[] = []
  EnumWindows((hwnd: Hwnd) => {
    handles.push(hwnd)
    return true // true = continuer l'énumération
  }, 0)
  return handles
}

/**
 * Liste les fenêtres qui ressemblent à de "vraies" fenêtres d'application :
 *  - visibles,
 *  - sans fenêtre propriétaire (pas une boîte de dialogue d'une autre fenêtre),
 *  - pas une "tool window" (petites fenêtres flottantes),
 *  - d'une taille minimale (on ignore les fenêtres minuscules / cachées hors écran).
 */
export function listAppWindows(): WindowInfo[] {
  const windows: WindowInfo[] = []
  for (const hwnd of listAllWindowHandles()) {
    if (!IsWindowVisible(hwnd)) continue
    if (GetWindow(hwnd, GW_OWNER)) continue
    const exStyle = getExStyle(hwnd)
    if (exStyle & WS_EX_TOOLWINDOW) continue
    const info = getWindowInfo(hwnd)
    const width = info.rect.right - info.rect.left
    const height = info.rect.bottom - info.rect.top
    if (width < 200 || height < 150) continue
    windows.push(info)
  }
  return windows
}

/** Rectangle complet du moniteur sur lequel se trouve (majoritairement) la fenêtre. */
export function getMonitorRectForWindow(hwnd: Hwnd): Rect | null {
  const monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
  if (!monitor) return null
  const info: Record<string, unknown> = { cbSize: koffi.sizeof(MONITORINFO) }
  if (!GetMonitorInfoW(monitor, info)) return null
  return info.rcMonitor as Rect
}

/** La fenêtre a-t-elle une barre de titre ? */
function hasCaption(style: number): boolean {
  return (style & WS_CAPTION) === WS_CAPTION
}

/**
 * Est-ce que cette fenêtre ressemble à la fenêtre PRINCIPALE d'un jeu,
 * et pas à un écran de démarrage (splash) ?
 *
 * Heuristique simple :
 *  - une fenêtre avec barre de titre = fenêtre "normale" → OK ;
 *  - une fenêtre sans barre de titre (popup) n'est retenue que si elle couvre
 *    au moins la moitié de l'écran (un jeu déjà en plein écran, par exemple).
 *    Les splash screens sont en général des petites popups sans bordure.
 */
export function looksLikeMainWindow(win: WindowInfo): boolean {
  if (hasCaption(win.style)) return true
  const monitor = getMonitorRectForWindow(win.hwnd)
  if (!monitor) return false
  const monitorArea = (monitor.right - monitor.left) * (monitor.bottom - monitor.top)
  const windowArea = (win.rect.right - win.rect.left) * (win.rect.bottom - win.rect.top)
  return windowArea >= monitorArea * 0.5
}

/** Vrai si la fenêtre existe encore. */
export function windowExists(hwnd: Hwnd): boolean {
  return Boolean(IsWindow(hwnd))
}

/** La fenêtre actuellement au premier plan (celle qui a le focus), ou null. */
export function getForegroundWindow(): Hwnd | null {
  return GetForegroundWindow() as Hwnd | null
}

// ----------------------------------------------------------------------------
//  8. Recherche de la fenêtre d'un jeu
// ----------------------------------------------------------------------------

export interface FindGameWindowOptions {
  /** Pid du processus qu'on a lancé (le .exe du jeu ou son launcher). */
  rootPid: number
  /** Fenêtres qui existaient AVANT le lancement (pour reconnaître les nouvelles). */
  windowsBeforeLaunch: Set<Hwnd>
  /** Pids à ne jamais prendre (ex. le hub lui-même). */
  excludedPids: Set<number>
}

export interface FoundWindow {
  window: WindowInfo
  /** Comment on l'a trouvée : via l'arbre de processus, ou "nouvelle fenêtre au premier plan". */
  source: 'process-tree' | 'foreground'
}

/**
 * Cherche la fenêtre principale du jeu. Renvoie null si pas (encore) trouvée.
 *
 * Stratégie :
 *  1. On prend toutes les fenêtres appartenant au processus lancé OU à un de
 *     ses descendants (cas des launchers). On ignore les splash screens.
 *     S'il y en a plusieurs, on garde la plus grande.
 *  2. Sinon (ex. le launcher a demandé à un autre programme de lancer le jeu),
 *     on regarde la fenêtre au premier plan : si elle est NOUVELLE (elle
 *     n'existait pas avant le lancement) et ressemble à une fenêtre principale,
 *     on considère que c'est le jeu.
 */
export function findGameWindow(options: FindGameWindowOptions): FoundWindow | null {
  const tree = getProcessTree(options.rootPid)
  const windows = listAppWindows()

  // --- 1. Fenêtres de l'arbre de processus ---
  const candidates = windows.filter(
    (w) => tree.has(w.pid) && !options.excludedPids.has(w.pid) && looksLikeMainWindow(w)
  )
  if (candidates.length > 0) {
    const area = (w: WindowInfo): number => (w.rect.right - w.rect.left) * (w.rect.bottom - w.rect.top)
    candidates.sort((a, b) => area(b) - area(a))
    return { window: candidates[0], source: 'process-tree' }
  }

  // --- 2. Nouvelle fenêtre au premier plan ---
  const foreground = getForegroundWindow()
  if (foreground && !options.windowsBeforeLaunch.has(foreground)) {
    const info = windows.find((w) => w.hwnd === foreground)
    if (info && !options.excludedPids.has(info.pid) && looksLikeMainWindow(info)) {
      return { window: info, source: 'foreground' }
    }
  }

  return null
}

// ----------------------------------------------------------------------------
//  9. Plein écran fenêtré sans bordure
// ----------------------------------------------------------------------------

/**
 * Vrai si la fenêtre est déjà sans bordure et couvre exactement son moniteur.
 * Sert à ne pas ré-appliquer le plein écran inutilement (et à le ré-appliquer
 * si le jeu remet sa bordure tout seul).
 */
export function isBorderlessFullscreen(hwnd: Hwnd): boolean {
  const style = getStyle(hwnd)
  if (hasCaption(style) || style & WS_THICKFRAME) return false
  const monitor = getMonitorRectForWindow(hwnd)
  if (!monitor) return false
  const rect = getWindowRect(hwnd)
  return (
    rect.left === monitor.left &&
    rect.top === monitor.top &&
    rect.right === monitor.right &&
    rect.bottom === monitor.bottom
  )
}

/**
 * Met une fenêtre au premier plan.
 *
 * Windows empêche normalement une appli de "voler" le focus. L'astuce classique :
 * simuler un appui sur la touche Alt juste avant, ce qui débloque
 * SetForegroundWindow. Comme c'est notre appli qui vient de lancer le jeu,
 * ça marche dans la grande majorité des cas.
 */
export function bringToFront(hwnd: Hwnd): boolean {
  // Fenêtre réduite (ex. un jeu qui se réduit quand il perd la main) : on la rouvre d'abord,
  // sinon elle reste réduite dans la barre des tâches même « au premier plan »
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE)
  if (SetForegroundWindow(hwnd)) return true
  keybd_event(VK_MENU, 0, 0, 0)
  keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
  BringWindowToTop(hwnd)
  return Boolean(SetForegroundWindow(hwnd))
}

/**
 * Passe la fenêtre en plein écran fenêtré sans bordure sur SON moniteur.
 * Renvoie true si tout s'est bien passé.
 *
 * Étapes :
 *  1. si la fenêtre est minimisée ou maximisée, on la "restaure" d'abord
 *     (sinon Windows ignore parfois le redimensionnement) ;
 *  2. on retire les styles de bordure / barre de titre ;
 *  3. on la place à la taille exacte du moniteur (SWP_FRAMECHANGED force
 *     Windows à redessiner le cadre avec les nouveaux styles) ;
 *  4. on la met au premier plan.
 */
export function makeBorderlessFullscreen(hwnd: Hwnd): boolean {
  if (!windowExists(hwnd)) return false

  // 1. Restaurer si minimisée/maximisée
  if (IsIconic(hwnd) || IsZoomed(hwnd)) {
    ShowWindow(hwnd, SW_RESTORE)
  }

  // 2. Retirer bordure et barre de titre
  const style = getStyle(hwnd)
  const newStyle = (style & ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU)) >>> 0
  SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle)

  const exStyle = getExStyle(hwnd)
  const newExStyle =
    (exStyle & ~(WS_EX_DLGMODALFRAME | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE | WS_EX_WINDOWEDGE)) >>> 0
  SetWindowLongPtrW(hwnd, GWL_EXSTYLE, newExStyle)

  // 3. Taille complète du moniteur (barre des tâches comprise)
  const monitor = getMonitorRectForWindow(hwnd)
  if (!monitor) return false
  const ok = SetWindowPos(
    hwnd,
    null, // HWND_TOP
    monitor.left,
    monitor.top,
    monitor.right - monitor.left,
    monitor.bottom - monitor.top,
    SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOOWNERZORDER
  )

  // 4. Premier plan
  bringToFront(hwnd)
  return Boolean(ok)
}

// ----------------------------------------------------------------------------
//  10. Manettes : bouton Guide (Xbox) et bouton PS (PlayStation)
// ----------------------------------------------------------------------------
//
//  Pourquoi ici et pas dans l'interface ? La Gamepad API de l'interface ne marche que quand
//  le hub est affiché. Or on veut entendre ce bouton même quand le hub est caché (en jeu)
//  ou fermé (Gamer Room près de l'horloge). On lit donc les manettes directement auprès de Windows.
//
//  - Manettes Xbox (et toutes celles vues comme Xbox : Steam Input, DS4Windows…) : XInput.
//    La fonction officielle XInputGetState ne donne PAS le bouton Guide ; on utilise sa version
//    « cachée » XInputGetStateEx (numéro 100 dans xinput1_4.dll), comme le fait Chromium.
//  - Manettes PlayStation branchées directement (DualShock 4, DualSense) : on lit leurs « rapports »
//    HID (les paquets d'octets envoyés par la manette) et on regarde le bit du bouton PS.

const xinput = koffi.load('xinput1_4.dll')
const cfgmgr32 = koffi.load('cfgmgr32.dll')
const hid = koffi.load('hid.dll')

const XINPUT_GAMEPAD = koffi.struct('XINPUT_GAMEPAD', {
  wButtons: 'uint16',
  bLeftTrigger: 'uint8',
  bRightTrigger: 'uint8',
  sThumbLX: 'int16',
  sThumbLY: 'int16',
  sThumbRX: 'int16',
  sThumbRY: 'int16'
})
const XINPUT_STATE_EX = koffi.struct('XINPUT_STATE_EX', {
  dwPacketNumber: 'uint32',
  Gamepad: XINPUT_GAMEPAD,
  dwPaddingReserved: 'uint32' // octets en plus de la version "Ex"
})
const GUID = koffi.struct('GUID', {
  Data1: 'uint32',
  Data2: 'uint16',
  Data3: 'uint16',
  Data4: koffi.array('uint8', 8)
})
const HIDD_ATTRIBUTES = koffi.struct('HIDD_ATTRIBUTES', {
  Size: 'uint32',
  VendorID: 'uint16',
  ProductID: 'uint16',
  VersionNumber: 'uint16'
})
void GUID // le type est utilisé par son nom dans les signatures ci-dessous

const XInputGetStateEx = xinput.func('__stdcall', 100, 'uint32', ['uint32', koffi.out(koffi.pointer(XINPUT_STATE_EX))])
const CM_Get_Device_Interface_List_SizeW = cfgmgr32.func(
  'uint32 __stdcall CM_Get_Device_Interface_List_SizeW(_Out_ uint32 *len, GUID *guid, void *device, uint32 flags)'
)
const CM_Get_Device_Interface_ListW = cfgmgr32.func(
  'uint32 __stdcall CM_Get_Device_Interface_ListW(GUID *guid, void *device, _Out_ uint8_t *buf, uint32 len, uint32 flags)'
)
const CreateFileW = kernel32.func(
  'void * __stdcall CreateFileW(str16 name, uint32 access, uint32 share, void *security, uint32 creation, uint32 flags, void *template)'
)
const ReadFile = kernel32.func(
  'bool __stdcall ReadFile(void *file, _Out_ uint8_t *buf, uint32 size, _Out_ uint32 *read, void *overlapped)'
)
const HidD_GetAttributes = hid.func('bool __stdcall HidD_GetAttributes(void *device, _Inout_ HIDD_ATTRIBUTES *attributes)')

const XINPUT_GAMEPAD_GUIDE = 0x0400 // bit du bouton Guide (non documenté)
const ERROR_SUCCESS = 0
const GENERIC_READ = 0x80000000
const FILE_SHARE_READ_WRITE = 0x1 | 0x2 // on partage la manette avec les jeux, Steam…
const OPEN_EXISTING = 3
/** Identifiant Windows de la famille "périphériques HID" (claviers, souris, manettes…). */
const GUID_DEVINTERFACE_HID = {
  Data1: 0x4d1e55b2,
  Data2: 0xf16f,
  Data3: 0x11cf,
  Data4: [0x88, 0xcb, 0x00, 0x11, 0x11, 0x00, 0x00, 0x30]
}
const SONY_VENDOR_ID = 0x054c
/** Numéros de modèle Sony : DualShock 4 (2 versions + adaptateur sans fil) et DualSense (+ Edge). */
const DUALSHOCK4_IDS = [0x05c4, 0x09cc, 0x0ba0]
const DUALSENSE_IDS = [0x0ce6, 0x0df2]

/** XInput dit "pas de manette" sur un emplacement : on ne le réinterroge que toutes les 2 s (c'est lent). */
const XINPUT_RETRY_DELAY = 2000
const xinputEmptyUntil = [0, 0, 0, 0]

/** Le bouton Guide d'une manette Xbox (XInput, 4 emplacements) est-il enfoncé ? */
export function isXboxGuidePressed(): boolean {
  const now = Date.now()
  let pressed = false
  for (let slot = 0; slot < 4; slot++) {
    if (now < xinputEmptyUntil[slot]) continue
    const state: { Gamepad?: { wButtons: number } } = {}
    if (XInputGetStateEx(slot, state) !== ERROR_SUCCESS) {
      xinputEmptyUntil[slot] = now + XINPUT_RETRY_DELAY
      continue
    }
    if ((state.Gamepad?.wButtons ?? 0) & XINPUT_GAMEPAD_GUIDE) pressed = true
  }
  return pressed
}

/** Une manette PlayStation ouverte en lecture. */
export interface SonyPad {
  handle: unknown
  path: string
  kind: 'ds4' | 'dualsense'
  bluetooth: boolean
  /** Mémoire où Windows écrit chaque rapport (une seule lecture à la fois par manette). */
  buffer: Buffer
}

/** Chemins Windows de tous les périphériques HID branchés. */
function listHidPaths(): string[] {
  const length = [0]
  if (CM_Get_Device_Interface_List_SizeW(length, GUID_DEVINTERFACE_HID, null, 0) !== 0 || !length[0]) return []
  const buffer = Buffer.alloc(length[0] * 2)
  if (CM_Get_Device_Interface_ListW(GUID_DEVINTERFACE_HID, null, buffer, length[0], 0) !== 0) return []
  return buffer.toString('utf16le').split('\0').filter(Boolean)
}

/** Modèle d'une manette Sony d'après son numéro, ou null si ce n'est pas une manette connue. */
function sonyKind(vendor: number, product: number): SonyPad['kind'] | null {
  if (vendor !== SONY_VENDOR_ID) return null
  if (DUALSENSE_IDS.includes(product)) return 'dualsense'
  if (DUALSHOCK4_IDS.includes(product)) return 'ds4'
  return null
}

/** Manettes Sony qu'on n'a pas pu ouvrir (pour ne l'écrire qu'une fois dans le journal). */
const refusedSonyPaths = new Set<string>()

/**
 * Ouvre les manettes PlayStation branchées (sauf celles déjà ouvertes, dont on donne les chemins).
 * Les fermer avec closeSonyPad.
 */
export function openSonyPads(alreadyOpen: Set<string>): SonyPad[] {
  const pads: SonyPad[] = []
  for (const path of listHidPaths()) {
    // Tri rapide sur le texte du chemin avant d'ouvrir quoi que ce soit (054c = Sony)
    if (!/054c/i.test(path) || alreadyOpen.has(path)) continue
    const handle = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ_WRITE, null, OPEN_EXISTING, 0, null)
    // INVALID_HANDLE_VALUE vaut -1, soit 0xFFFFFFFFFFFFFFFF en pointeur 64 bits.
    if (!handle || handle === 0xffffffffffffffffn) {
      // Souvent : un autre programme (ex. Steam Input) a ouvert la manette pour lui seul
      if (!refusedSonyPaths.has(path)) console.log(`[manette] Manette Sony vue mais impossible à ouvrir (${path})`)
      refusedSonyPaths.add(path)
      continue
    }
    const attributes: Record<string, unknown> = { Size: koffi.sizeof(HIDD_ATTRIBUTES) }
    const kind = HidD_GetAttributes(handle, attributes)
      ? sonyKind(attributes.VendorID as number, attributes.ProductID as number)
      : null
    if (!kind) {
      CloseHandle(handle)
      continue
    }
    // Bluetooth : le chemin contient l'identifiant du service HID Bluetooth (00001124-…)
    pads.push({ handle, path, kind, bluetooth: /00001124-/i.test(path), buffer: Buffer.alloc(512) })
  }
  return pads
}

export function closeSonyPad(pad: SonyPad): void {
  CloseHandle(pad.handle)
}

/**
 * Lit UN rapport de la manette, sans bloquer l'appli (la lecture se fait dans un autre fil).
 * `callback(pressed)` : le bouton PS est-il enfoncé ? `pressed` vaut null si la manette a été débranchée.
 */
export function readSonyPsButton(pad: SonyPad, callback: (pressed: boolean | null) => void): void {
  const read = [0]
  ReadFile.async(pad.handle, pad.buffer, pad.buffer.length, read, null, (error: unknown, ok: boolean) => {
    if (error || !ok || read[0] === 0) return callback(null)
    callback(psButtonFromReport(pad, pad.buffer))
  })
}

/**
 * Où se trouve le bouton PS dans le rapport (bit 0 d'un octet qui dépend du modèle et du branchement) :
 *  - DualSense USB (rapport 0x01) : octet 10 ; Bluetooth complet (0x31) : octet 11 ; Bluetooth simple (0x01) : octet 7 ;
 *  - DualShock 4 USB ou Bluetooth simple (0x01) : octet 7 ; Bluetooth complet (0x11) : octet 9.
 */
function psButtonFromReport(pad: SonyPad, report: Buffer): boolean {
  const id = report[0]
  let index = -1
  if (pad.kind === 'dualsense') {
    if (id === 0x31) index = 11
    else if (id === 0x01) index = pad.bluetooth ? 7 : 10
  } else {
    if (id === 0x11) index = 9
    else if (id === 0x01) index = 7
  }
  return index >= 0 && (report[index] & 0x01) !== 0
}

/** Le HWND d'une fenêtre Electron (BrowserWindow.getNativeWindowHandle() renvoie 8 octets). */
export function hwndFromBuffer(buffer: Buffer): Hwnd {
  return buffer.readBigUInt64LE(0)
}
