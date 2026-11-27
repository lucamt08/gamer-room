// Lancer un jeu Battle.net jusqu'au bout, sans avoir à cliquer sur « Jouer » dans Battle.net.
//
// Le problème : Battle.net.exe --exec="launch WTCG" ne LANCE le jeu que si Battle.net est déjà ouvert
// (et connecté). Si Battle.net est fermé, la même commande l'ouvre seulement sur la page du jeu.
//
// La solution :
//  1. Battle.net déjà ouvert (même réduit près de l'horloge) → on envoie la commande tout de suite ;
//  2. Battle.net fermé → on l'ouvre d'abord, on attend sa fenêtre, puis quelques secondes de connexion,
//     et seulement ensuite gameLauncher.ts envoie la commande de lancement ;
//  3. si le jeu n'a toujours pas démarré 20 s après la commande (connexion lente…), gameLauncher.ts la
//     renvoie une fois (voir BATTLE_NET_RETRY_DELAY).

import { spawn } from 'node:child_process'
import { basename, dirname } from 'node:path'
import type { Game } from '@shared/types'
import * as wm from '../windowManager'

const BATTLE_NET_EXE = 'battle.net.exe'
const WINDOW_TIMEOUT = 60_000 // on attend la fenêtre de Battle.net 60 s max (mise à jour au démarrage…)
const SETTLE_DELAY = 6_000 // fenêtre apparue : on laisse 6 s à Battle.net pour se connecter
/** Le jeu n'a pas démarré après la commande de lancement : on la renvoie une fois, après ce délai. */
export const BATTLE_NET_RETRY_DELAY = 20_000

/** Ce jeu est-il lancé par Battle.net.exe --exec="launch …" ? */
export function isBattleNetLaunch(game: Game): boolean {
  return game.launchKind === 'store' && game.source === 'battlenet' && basename(game.exePath).toLowerCase() === BATTLE_NET_EXE
}

/** Pids de Battle.net.exe s'il est ouvert. */
function battleNetPids(): number[] {
  return [...wm.snapshotProcesses().values()].filter((p) => p.exeName.toLowerCase() === BATTLE_NET_EXE).map((p) => p.pid)
}

/** Petite pause (en tenant compte du bouton « Annuler »). */
async function wait(ms: number, cancelled: () => boolean): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end && !cancelled()) await new Promise((resolve) => setTimeout(resolve, 250))
}

/**
 * Si Battle.net est fermé : l'ouvre et attend qu'il soit prêt. Ne fait rien s'il est déjà ouvert.
 * `onStart` est appelé quand on commence à l'ouvrir (pour afficher l'étape à l'écran).
 * Ne lance jamais d'erreur : au pire, la commande de lancement ouvrira Battle.net sur la page du jeu.
 */
export async function ensureBattleNetReady(game: Game, onStart: () => void, cancelled: () => boolean): Promise<void> {
  if (!isBattleNetLaunch(game) || battleNetPids().length > 0) return
  try {
    onStart()
    console.log('[battle.net] Battle.net est fermé : ouverture avant le lancement du jeu')
    const started = Date.now()
    const child = spawn(game.exePath, [], { cwd: dirname(game.exePath), detached: true, stdio: 'ignore' })
    child.once('error', (error) => console.warn('[battle.net] Ouverture impossible', error.message))
    child.unref()

    // On attend une fenêtre de Battle.net (il lance plusieurs processus : on les reprend à chaque fois)
    while (Date.now() - started < WINDOW_TIMEOUT && !cancelled()) {
      const pids = battleNetPids()
      if (wm.listAppWindows().some((w) => pids.includes(w.pid))) break
      await wait(500, cancelled)
    }
    await wait(SETTLE_DELAY, cancelled)
    console.log(`[battle.net] Prêt après ${Math.round((Date.now() - started) / 1000)} s`)
  } catch (error) {
    console.warn('[battle.net] Erreur pendant l\'ouverture de Battle.net', error)
  }
}
