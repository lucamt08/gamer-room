// Mise à jour automatique via les "Releases" GitHub du dépôt.
//
// Fonctionnement :
//  - au démarrage, l'appli INSTALLÉE regarde s'il existe une Release plus récente
//    (electron-updater lit le fichier latest.yml publié avec l'installateur) ;
//  - si oui, l'interface affiche un bandeau "Nouvelle version disponible" ;
//  - l'utilisateur clique → téléchargement → l'appli redémarre sur la nouvelle version.
//
// En développement (npm run dev), il n'y a pas de mise à jour : on ne fait rien.

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

// electron-updater est un module CommonJS : on récupère autoUpdater ainsi
const { autoUpdater } = electronUpdater

let send: (status: UpdateStatus) => void = () => {}
/** Vrai si l'utilisateur a cliqué lui-même sur "Vérifier les mises à jour". */
let manualCheck = false

/**
 * Les erreurs d'electron-updater peuvent faire des dizaines de lignes (en-têtes HTTP…).
 * On garde un message court pour l'interface, le détail part dans la console.
 * Si la vérification était automatique (au démarrage), on n'affiche rien :
 * pas la peine d'embêter l'utilisateur s'il est hors ligne, par exemple.
 */
function reportError(error: Error): void {
  console.error('[updater]', error)
  if (!manualCheck) return
  const short = /404/.test(error.message)
    ? 'aucune version publiée trouvée sur GitHub.'
    : /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|net::/.test(error.message)
      ? 'pas de connexion Internet.'
      : error.message.split('\n')[0].slice(0, 160)
  send({ state: 'error', message: short })
}

export function initUpdater(onStatus: (status: UpdateStatus) => void): void {
  send = onStatus
  if (!app.isPackaged) return // pas de mise à jour en mode développement

  autoUpdater.autoDownload = false // on demande à l'utilisateur avant de télécharger
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
  // "Pas de nouvelle version" n'est affiché que si l'utilisateur a demandé lui-même
  autoUpdater.on('update-not-available', () => send({ state: manualCheck ? 'not-available' : 'idle' }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (error) => reportError(error))

  // Petite pause pour laisser l'interface se charger avant de vérifier
  setTimeout(() => checkForUpdates(false), 3000)
}

/** `manual` = true quand l'utilisateur clique sur "Vérifier les mises à jour". */
export function checkForUpdates(manual = true): void {
  manualCheck = manual
  if (!app.isPackaged) {
    send({ state: 'error', message: 'pas de mise à jour en mode développement (npm run dev).' })
    return
  }
  // Les erreurs sont aussi signalées par l'événement 'error' ci-dessus
  autoUpdater.checkForUpdates().catch(() => {})
}

export function downloadUpdate(): void {
  manualCheck = true
  autoUpdater.downloadUpdate().catch(() => {})
}

/** Ferme l'appli, installe la mise à jour et relance. */
export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
