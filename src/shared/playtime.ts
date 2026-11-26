// Temps de jeu : quel chiffre afficher, et comment l'écrire.
// Partagé entre le main et l'interface.

import type { Game } from './types'

/** Le temps de jeu vient-il de Steam (et non du compteur de Gamer Room) ? */
export function playtimeFromSteam(game: Game): boolean {
  return !!game.steamAppId && game.steamPlaytimeMinutes != null
}

/**
 * Temps de jeu total à afficher, en secondes :
 *  - jeu Steam : le chiffre de Steam (il compte toutes les parties, même lancées depuis Gamer Room) ;
 *  - sinon (ou si le fichier de Steam est illisible) : le compteur de Gamer Room.
 * On n'additionne jamais les deux, sinon les parties seraient comptées deux fois.
 */
export function totalPlaytimeSeconds(game: Game): number {
  if (playtimeFromSteam(game)) return game.steamPlaytimeMinutes! * 60
  return game.playtimeSeconds ?? 0
}

/**
 * Écrit une durée lisible : "45 min", "3 h 05", "120 h 30".
 * Renvoie une chaîne vide en dessous d'une minute (rien à afficher).
 */
export function formatPlaytime(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60)
  if (totalMinutes < 1) return ''
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return `${hours.toLocaleString('fr-FR')} h ${String(minutes).padStart(2, '0')}`
}
