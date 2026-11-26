// Flawless Widescreen : lancer un jeu avec son correctif (ultrawide, FPS…) déjà activé.
//
// Comment marche Flawless Widescreen (FWS) :
//  - chaque jeu pris en charge a un "module" (correctif), installé dans
//      <dossier de FWS>\PluginCache\<plugin>\Modules\<module>\ ;
//  - le script du module (Dependencies\Scripts\<module>.lua) indique le .exe du jeu :
//      Process_EXEName = "P5R.exe"   (plusieurs séparés par ";", ou "*" = n'importe lequel) ;
//  - les réglages du correctif sont dans EnviromentState.xml, à côté. FWS retient tout SAUF la case
//    principale « Fix Enabled » (CheckBox_Enable), qu'il remet à 0 : c'est pour ça qu'il fallait la recocher ;
//  - settings.xml (à la racine de FWS) liste les onglets de jeux ouverts au démarrage (OpenViewports).
//
// Ce que fait Gamer Room au clic sur « Jouer » (si le jeu a un correctif) :
//  1. si FWS est déjà ouvert, on le ferme (il doit redémarrer pour lire la case cochée) ;
//  2. on coche « Fix Enabled » dans le fichier du correctif et on ouvre son onglet au démarrage ;
//  3. on lance FWS (en administrateur, sans fenêtre d'autorisation grâce à adminTasks.ts) ;
//  4. on attend qu'il soit prêt, puis gameLauncher.ts lance le jeu. FWS reste ouvert après le jeu.
//
// Rien n'est propre à un jeu : tout est lu dans les fichiers de FWS, donc ça marche sur n'importe quel PC.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { FwsGameInfo, FwsModule, FwsStatus, Game } from '@shared/types'
import * as wm from './windowManager'
import { getSettings } from './settings'
import { samePath } from './launchLearning'
import { createAdminTasks, getTaskCommand, runTask } from './adminTasks'

const EXE_NAME = 'FlawlessWidescreen.exe'
/** Noms des deux tâches administrateur (voir adminTasks.ts). */
const TASK_LAUNCH = 'Flawless Widescreen - Lancer'
const TASK_CLOSE = 'Flawless Widescreen - Fermer'

const CLOSE_TIMEOUT = 10_000 // FWS déjà ouvert : on attend sa fermeture 10 s max
const START_TIMEOUT = 30_000 // on attend la fenêtre de FWS 30 s max (il peut vérifier ses mises à jour)
const READY_DELAY = 3_000 // fenêtre apparue : on laisse encore 3 s à FWS pour charger le correctif
const FOLDER_SEARCH_LIMIT = 20_000 // on n'inspecte pas plus de 20 000 fichiers par dossier de jeu

// ----------------------------------------------------------------------------
//  1. Trouver Flawless Widescreen
// ----------------------------------------------------------------------------

/** Ce dossier contient-il FlawlessWidescreen.exe ? */
function isFwsFolder(folder: string | null | undefined): folder is string {
  return !!folder && existsSync(join(folder, EXE_NAME))
}

/** Dossier d'installation noté par Windows dans la liste des programmes installés, ou null. */
function folderFromRegistry(): string | null {
  const hives = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]
  for (const hive of hives) {
    try {
      // Cherche les programmes dont le nom affiché contient "Flawless Widescreen"
      const found = execFileSync('reg', ['query', hive, '/s', '/f', 'Flawless Widescreen', '/d'], {
        encoding: 'utf8',
        windowsHide: true
      })
      for (const key of found.split(/\r?\n/).filter((line) => line.startsWith('HKEY_'))) {
        const output = execFileSync('reg', ['query', key.trim(), '/v', 'InstallLocation'], {
          encoding: 'utf8',
          windowsHide: true
        })
        const match = /InstallLocation\s+REG_SZ\s+(.+)/.exec(output)
        if (match && isFwsFolder(match[1].trim())) return match[1].trim()
      }
    } catch {
      // rien trouvé dans cette partie du registre
    }
  }
  return null
}

let cachedFolder: { value: string | null; at: number; setting: string } | null = null

/**
 * Dossier de Flawless Widescreen, ou null s'il n'est pas installé :
 *  1. celui choisi dans les paramètres ;
 *  2. sinon celui noté dans la liste des programmes installés de Windows ;
 *  3. sinon les emplacements habituels.
 * Le résultat est gardé 1 minute (la recherche dans le registre prend un peu de temps).
 */
export function findFwsFolder(): string | null {
  const setting = getSettings().fwsPath
  if (cachedFolder && cachedFolder.setting === setting && Date.now() - cachedFolder.at < 60_000) {
    return cachedFolder.value
  }
  const programFiles = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles']]
    .filter((p): p is string => !!p)
    .map((p) => join(p, 'Flawless Widescreen'))
  const value = [setting].find(isFwsFolder) ?? folderFromRegistry() ?? programFiles.find(isFwsFolder) ?? null
  cachedFolder = { value, at: Date.now(), setting }
  return value
}

/** Dossier de FWS à partir d'un choix fait à la main (le dossier ou son FlawlessWidescreen.exe), ou null s'il ne convient pas. */
export function isValidFwsChoice(path: string): string | null {
  const folder = basename(path).toLowerCase() === EXE_NAME.toLowerCase() ? dirname(path) : path
  return isFwsFolder(folder) ? folder : null
}

/** Oublie le dossier trouvé (après un changement dans les paramètres). */
export function forgetFwsFolder(): void {
  cachedFolder = null
}

// ----------------------------------------------------------------------------
//  2. Lister les correctifs installés
// ----------------------------------------------------------------------------

/** Liste des dossiers (seulement les dossiers) d'un dossier, ou [] s'il n'existe pas. */
function subFolders(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Noms lisibles des modules, lus dans le catalogue de FWS : <Module NameSpace="X"><FriendlyName>Nom</FriendlyName>. */
function readFriendlyNames(fwsFolder: string): Map<string, string> {
  const names = new Map<string, string>()
  const repoFolder = join(fwsFolder, 'RepositoryCache')
  try {
    for (const file of readdirSync(repoFolder).filter((f) => f.toLowerCase().endsWith('.xml'))) {
      const text = readFileSync(join(repoFolder, file), 'utf8')
      for (const match of text.matchAll(/<Module NameSpace="([^"]+)">\s*<FriendlyName>([^<]+)<\/FriendlyName>/g)) {
        names.set(match[1], match[2].trim())
      }
    }
  } catch {
    // pas de catalogue : on utilisera le nom du dossier
  }
  return names
}

/** "Persona5Royal" → "Persona5 Royal" (nom de secours quand le catalogue est absent). */
function spacedName(module: string): string {
  return module.replace(/([a-z])([A-Z])/g, '$1 $2')
}

/** Tous les correctifs installés dans Flawless Widescreen, triés par nom. */
export function listModules(fwsFolder: string): FwsModule[] {
  const friendly = readFriendlyNames(fwsFolder)
  const modules: FwsModule[] = []
  const cache = join(fwsFolder, 'PluginCache')
  for (const plugin of subFolders(cache)) {
    for (const module of subFolders(join(cache, plugin, 'Modules'))) {
      const scripts = join(cache, plugin, 'Modules', module, 'Dependencies', 'Scripts')
      let script = ''
      try {
        const file = readdirSync(scripts).find((f) => f.toLowerCase().endsWith('.lua'))
        if (file) script = readFileSync(join(scripts, file), 'utf8')
      } catch {
        // module incomplet (téléchargement interrompu…)
      }
      const exeLine = /Process_EXEName\s*=\s*"([^"]*)"/.exec(script)?.[1] ?? '*'
      modules.push({
        key: `${plugin}/${module}`,
        plugin,
        module,
        name: friendly.get(module) ?? spacedName(module),
        exeNames: exeLine
          .split(';')
          .map((name) => name.trim().toLowerCase())
          .filter((name) => name.endsWith('.exe')),
        anticheat: /anti-?cheat/i.test(script)
      })
    }
  }
  return modules.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

// ----------------------------------------------------------------------------
//  3. Quel correctif pour quel jeu ?
// ----------------------------------------------------------------------------

/** Noms des .exe présents dans un dossier de jeu (gardés en mémoire : un dossier change rarement). */
const exeNamesByFolder = new Map<string, Set<string>>()

/** Tous les .exe d'un dossier et de ses sous-dossiers (4 niveaux max), en minuscules. */
function exeNamesIn(folder: string): Set<string> {
  const key = folder.toLowerCase()
  const cached = exeNamesByFolder.get(key)
  if (cached) return cached

  const found = new Set<string>()
  let inspected = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || inspected > FOLDER_SEARCH_LIMIT) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      inspected++
      if (entry.isDirectory()) walk(join(dir, entry.name), depth + 1)
      else if (entry.name.toLowerCase().endsWith('.exe')) found.add(entry.name.toLowerCase())
    }
  }
  walk(folder, 0)
  exeNamesByFolder.set(key, found)
  return found
}

/** "Persona 5: Royal™" → "persona5royal" (pour comparer des noms de jeux). */
function simplify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Le correctif qui correspond à ce jeu, ou null :
 *  1. le .exe du jeu (ou son vrai .exe) est un de ceux du correctif ;
 *  2. sinon, un .exe du correctif est présent dans le dossier du jeu (jeux Steam, launchers…) ;
 *  3. sinon, pour un correctif qui accepte n'importe quel .exe : même nom de jeu.
 */
export function detectModule(game: Game, modules: FwsModule[]): FwsModule | null {
  const ownExes = new Set(
    [game.exePath, game.realExePath].filter((p): p is string => !!p).map((p) => basename(p).toLowerCase())
  )
  const byExe = modules.find((m) => m.exeNames.some((name) => ownExes.has(name)))
  if (byExe) return byExe

  // Dossier du jeu (pour un jeu Steam, surtout pas le dossier de Steam lui-même)
  const folder = game.gameFolder ?? (game.launchKind !== 'steam' ? dirname(game.exePath) : null)
  if (folder && existsSync(folder)) {
    const inFolder = exeNamesIn(folder)
    const byFolder = modules.find((m) => m.exeNames.some((name) => inFolder.has(name)))
    if (byFolder) return byFolder
  }

  return modules.find((m) => m.exeNames.length === 0 && simplify(m.name) === simplify(game.name)) ?? null
}

/** Le correctif à activer au lancement de ce jeu, ou null (voir le champ fwsModule dans types.ts). */
function moduleToEnable(game: Game, modules: FwsModule[]): FwsModule | null {
  const choice = game.fwsModule ?? 'auto'
  if (choice === 'off') return null
  if (choice !== 'auto') return modules.find((m) => m.key === choice) ?? null
  const detected = detectModule(game, modules)
  // Correctif avec avertissement anti-cheat : seulement si on l'a choisi à la main
  return detected && !detected.anticheat ? detected : null
}

/** Infos pour l'écran "Modifier". */
export function getGameInfo(game: Game): FwsGameInfo {
  const folder = findFwsFolder()
  if (!folder) return { installed: false, modules: [], detectedKey: null }
  const modules = listModules(folder)
  return { installed: true, modules, detectedKey: detectModule(game, modules)?.key ?? null }
}

// ----------------------------------------------------------------------------
//  4. Autorisation administrateur (une seule fois)
// ----------------------------------------------------------------------------

/** Les tâches existent-elles et lancent-elles bien CE FlawlessWidescreen.exe ? */
async function isAuthorized(folder: string): Promise<boolean> {
  return samePath(await getTaskCommand(TASK_LAUNCH), join(folder, EXE_NAME)) && (await getTaskCommand(TASK_CLOSE)) !== null
}

/** Crée les deux tâches (lancer / fermer FWS). Windows demande l'autorisation une fois. */
export async function authorize(): Promise<boolean> {
  const folder = findFwsFolder()
  if (!folder) return false
  return createAdminTasks([
    { name: TASK_LAUNCH, command: join(folder, EXE_NAME), workingDir: folder },
    {
      name: TASK_CLOSE,
      command: join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      args: `/IM ${EXE_NAME} /F`
    }
  ])
}

/** État de Flawless Widescreen pour l'écran des paramètres. */
export async function getStatus(): Promise<FwsStatus> {
  const folder = findFwsFolder()
  if (!folder) return { folder: null, authorized: false, moduleCount: 0 }
  return { folder, authorized: await isAuthorized(folder), moduleCount: listModules(folder).length }
}

// ----------------------------------------------------------------------------
//  5. Activer le correctif dans les fichiers de FWS
// ----------------------------------------------------------------------------

/** Fichier de réglages d'un correctif quand FWS ne l'a encore jamais créé : juste la case cochée. */
function minimalState(module: string): string {
  return [
    `<StepState Schema="1.0" NameSpace="${module}">`,
    '\t<StepStates>',
    '\t\t<StepState Step="1">',
    '\t\t\t<ControlState>',
    '\t\t\t\t<Control Type="CheckBox" ID="CheckBox_Enable">',
    '\t\t\t\t\t<CheckBoxProperties CheckState="1"/>',
    '\t\t\t\t</Control>',
    '\t\t\t</ControlState>',
    '\t\t\t<ViewportState SBVertPos="0"/>',
    '\t\t</StepState>',
    '\t\t<ViewportState LastStep="1"/>',
    '\t</StepStates>',
    '</StepState>',
    ''
  ].join('\n')
}

/** Coche « Fix Enabled » dans EnviromentState.xml du correctif (en gardant tous les autres réglages). */
function checkFixEnabled(fwsFolder: string, m: FwsModule): void {
  const file = join(fwsFolder, 'PluginCache', m.plugin, 'Modules', m.module, 'EnviromentState.xml')
  if (!existsSync(file)) {
    writeFileSync(file, minimalState(m.module), 'utf8')
    return
  }
  let text = readFileSync(file, 'utf8')
  const checkbox = /(<Control Type="CheckBox" ID="CheckBox_Enable">\s*<CheckBoxProperties CheckState=")\d+(")/
  if (checkbox.test(text)) {
    text = text.replace(checkbox, (_all, before: string, after: string) => `${before}1${after}`)
  } else {
    // Case absente du fichier : on l'ajoute au début des réglages
    text = text.replace(
      '<ControlState>',
      '<ControlState>\n\t\t\t\t<Control Type="CheckBox" ID="CheckBox_Enable">\n\t\t\t\t\t<CheckBoxProperties CheckState="1"/>\n\t\t\t\t</Control>'
    )
  }
  writeFileSync(file, text, 'utf8')
}

/** Dans settings.xml de FWS : l'onglet du correctif est ouvert au démarrage et affiché devant. */
function openModuleTab(fwsFolder: string, m: FwsModule): void {
  const file = join(fwsFolder, 'settings.xml')
  if (!existsSync(file)) return // FWS jamais lancé : il créera ses réglages lui-même
  const text = readFileSync(file, 'utf8')

  // Onglets déjà ouverts (on les garde, mais seul le nôtre est au premier plan)
  const current = /<OpenViewports>([\s\S]*?)<\/OpenViewports>/.exec(text)?.[1] ?? ''
  const tabs = [...current.matchAll(/<Viewport PluginNameSpace="([^"]+)" ModuleNameSpace="([^"]+)"/g)].map((v) => ({
    plugin: v[1],
    module: v[2]
  }))
  if (!tabs.some((t) => t.plugin === m.plugin && t.module === m.module)) tabs.push({ plugin: m.plugin, module: m.module })
  const lines = tabs.map(
    (t) =>
      `\t\t\t<Viewport PluginNameSpace="${t.plugin}" ModuleNameSpace="${t.module}" Focus="${t.plugin === m.plugin && t.module === m.module}"/>`
  )
  const block = `<OpenViewports>\n${lines.join('\n')}\n\t\t</OpenViewports>`

  let updated: string
  if (/<OpenViewports>[\s\S]*?<\/OpenViewports>/.test(text)) updated = text.replace(/<OpenViewports>[\s\S]*?<\/OpenViewports>/, block)
  else if (text.includes('<OpenViewports/>')) updated = text.replace('<OpenViewports/>', block)
  else if (/<AppState[^>]*\/>/.test(text)) updated = text.replace(/<AppState([^>]*)\/>/, `<AppState$1>\n\t\t${block}\n\t</AppState>`)
  else if (/<AppState[^>]*>/.test(text)) updated = text.replace(/(<AppState[^>]*>)/, `$1\n\t\t${block}`)
  else return // format inconnu : on ne touche à rien
  writeFileSync(file, updated, 'utf8')
}

// ----------------------------------------------------------------------------
//  6. Au clic sur « Jouer »
// ----------------------------------------------------------------------------

/** Pid de Flawless Widescreen s'il est ouvert, sinon null. */
function fwsPid(): number | null {
  for (const p of wm.snapshotProcesses().values()) if (p.exeName.toLowerCase() === EXE_NAME.toLowerCase()) return p.pid
  return null
}

/** Attend qu'une condition soit vraie (vérifiée toutes les 0,5 s). Renvoie false après le délai. */
async function waitUntil(condition: () => boolean, timeout: number, cancelled: () => boolean): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (cancelled()) return false
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return condition()
}

/**
 * Si ce jeu a un correctif Flawless Widescreen à activer : démarre FWS avec « Fix Enabled » coché.
 * Ne lance jamais d'erreur : en cas de souci, renvoie un message (le jeu se lance quand même, sans correctif).
 *  - `onStart` est appelé quand on commence (pour afficher l'étape à l'écran) ;
 *  - `cancelled` dit si l'utilisateur a cliqué sur « Annuler » entre-temps.
 */
export async function prepareForGame(game: Game, onStart: (m: FwsModule) => void, cancelled: () => boolean): Promise<string | null> {
  try {
    const folder = findFwsFolder()
    if (!folder) return null
    const m = moduleToEnable(game, listModules(folder))
    if (!m) return null

    onStart(m)
    console.log(`[flawless] Correctif "${m.name}" pour "${game.name}"`)

    // Autorisation administrateur : demandée une seule fois (ou si FWS a été déplacé)
    if (!(await isAuthorized(folder)) && !(await authorize())) {
      return 'Flawless Widescreen : autorisation refusée, jeu lancé sans correctif'
    }

    // FWS déjà ouvert : on le ferme, il doit redémarrer pour lire la case cochée
    if (fwsPid() !== null) {
      await runTask(TASK_CLOSE)
      if (!(await waitUntil(() => fwsPid() === null, CLOSE_TIMEOUT, cancelled))) {
        return cancelled() ? null : "Flawless Widescreen n'a pas pu être redémarré : jeu lancé sans correctif"
      }
    }

    checkFixEnabled(folder, m)
    openModuleTab(folder, m)

    if (!(await runTask(TASK_LAUNCH))) return "Flawless Widescreen n'a pas pu être lancé : jeu lancé sans correctif"
    const windowShown = await waitUntil(
      () => {
        const pid = fwsPid()
        return pid !== null && wm.listAppWindows().some((w) => w.pid === pid)
      },
      START_TIMEOUT,
      cancelled
    )
    if (cancelled()) return null
    if (!windowShown) console.warn("[flawless] Pas de fenêtre de Flawless Widescreen : on lance le jeu quand même")
    await new Promise((resolve) => setTimeout(resolve, READY_DELAY))
    return null
  } catch (error) {
    console.error('[flawless] Erreur', error)
    return 'Flawless Widescreen : erreur, jeu lancé sans correctif'
  }
}
