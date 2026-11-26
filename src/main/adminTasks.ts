// Lancer un programme en administrateur SANS la fenêtre « Voulez-vous autoriser… ? » à chaque fois.
//
// Le principe : une "tâche planifiée" Windows, rangée dans le dossier « Gamer Room » du Planificateur
// de tâches, avec l'option « Exécuter avec les autorisations maximales ».
//  - Pour CRÉER la tâche, Windows demande l'autorisation administrateur UNE SEULE FOIS.
//  - Ensuite, Gamer Room n'a plus qu'à la DÉCLENCHER (schtasks /Run) : aucune fenêtre d'autorisation.
// Chaque tâche ne lance qu'un seul programme précis : elle ne donne pas les droits administrateur
// à Gamer Room. On peut voir ou supprimer ces tâches dans le Planificateur de tâches de Windows.

import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'

/** Dossier des tâches de Gamer Room dans le Planificateur de tâches. */
const TASK_FOLDER = '\\Gamer Room\\'

/** Une tâche à créer : un programme, ses arguments et son dossier de travail. */
export interface AdminTask {
  /** Nom de la tâche, ex. "Flawless Widescreen - Lancer". */
  name: string
  command: string
  args?: string
  workingDir?: string
}

/** Lance une commande Windows et renvoie ce qu'elle a écrit (ou une erreur). */
function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/** Texte entre guillemets simples pour PowerShell (les ' sont doublés). */
function psQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

/**
 * Programme lancé par une tâche existante (pour vérifier qu'elle pointe toujours au bon endroit),
 * ou null si la tâche n'existe pas.
 */
export async function getTaskCommand(name: string): Promise<string | null> {
  try {
    const xml = await run('schtasks', ['/Query', '/TN', TASK_FOLDER + name, '/XML'])
    const match = /<Command>([^<]*)<\/Command>/.exec(xml)
    return match ? match[1].replace(/&amp;/g, '&').replace(/^"|"$/g, '') : null
  } catch {
    return null // tâche absente
  }
}

/** Un fichier ou dossier protégé (ex. dans Program Files) que l'utilisateur doit pouvoir modifier. */
export interface WritablePath {
  path: string
  /** true = dossier : le droit s'applique aussi à tout ce qu'il contient (et contiendra). */
  folder: boolean
}

/**
 * Crée (ou remplace) des tâches administrateur. Windows affiche UNE fenêtre d'autorisation pour toutes.
 * `writable` : fichiers/dossiers protégés que l'utilisateur pourra ensuite modifier (droit « Modifier »),
 * profitant de la même fenêtre d'autorisation.
 * Renvoie false si l'utilisateur a refusé (ou si la création a échoué).
 */
export async function createAdminTasks(tasks: AdminTask[], writable: WritablePath[] = []): Promise<boolean> {
  // La tâche doit tourner dans la session de l'utilisateur actuel (pour que la fenêtre s'affiche),
  // même si c'est un autre compte qui donne l'autorisation administrateur.
  const user = `${process.env['USERDOMAIN'] ?? '.'}\\${userInfo().username}`

  // Script exécuté EN ADMINISTRATEUR : il enregistre chaque tâche
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$principal = New-ScheduledTaskPrincipal -UserId ${psQuote(user)} -LogonType Interactive -RunLevel Highest`,
    // Pas de limite de durée (par défaut Windows arrête une tâche après 72 h), même sur batterie
    '$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 4'
  ]
  for (const task of tasks) {
    const action = [`New-ScheduledTaskAction -Execute ${psQuote(task.command)}`]
    if (task.args) action.push(`-Argument ${psQuote(task.args)}`)
    if (task.workingDir) action.push(`-WorkingDirectory ${psQuote(task.workingDir)}`)
    lines.push(
      `Register-ScheduledTask -TaskName ${psQuote(task.name)} -TaskPath ${psQuote(TASK_FOLDER)} ` +
        `-Action (${action.join(' ')}) -Principal $principal -Settings $settings -Force | Out-Null`
    )
  }
  // Droit « Modifier » pour l'utilisateur (icacls). (OI)(CI) = hérité par les fichiers et sous-dossiers.
  for (const item of writable) {
    const right = item.folder ? '(OI)(CI)M' : 'M'
    lines.push(`icacls ${psQuote(item.path)} /grant ${psQuote(`${user}:${right}`)} | Out-Null`)
    lines.push('if ($LASTEXITCODE -ne 0) { exit 1 }')
  }
  // Le script est passé en Base64 (UTF-16) : aucun problème de guillemets ou d'accents
  const encoded = Buffer.from(lines.join('\n'), 'utf16le').toString('base64')

  // Start-Process -Verb RunAs = « Exécuter en tant qu'administrateur » → fenêtre d'autorisation de Windows.
  // -Wait : on attend la fin ; on renvoie le code de sortie du script administrateur.
  const launcher =
    `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; exit $p.ExitCode`
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', launcher])
    return true
  } catch (error) {
    // Fenêtre d'autorisation refusée (« Non »), ou erreur pendant la création
    console.warn("[tâches] Création des tâches administrateur refusée ou impossible", (error as Error).message)
    return false
  }
}

/** Déclenche une tâche (sans fenêtre d'autorisation). Renvoie false si elle n'existe pas. */
export async function runTask(name: string): Promise<boolean> {
  try {
    await run('schtasks', ['/Run', '/TN', TASK_FOLDER + name])
    return true
  } catch (error) {
    console.warn(`[tâches] Impossible de déclencher "${name}"`, (error as Error).message)
    return false
  }
}
