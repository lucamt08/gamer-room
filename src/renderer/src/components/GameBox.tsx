// Une boîte de jeu en 3D (CSS uniquement), placée dans le carrousel :
//  - une face avant (la jaquette dans un boîtier), deux tranches (avec le nom du jeu),
//    et des faces du dessus / du dessous pour l'épaisseur,
//  - sa position dépend de son écart avec le jeu sélectionné ("offset") :
//    0 = au centre, de face ; négatif = à gauche ; positif = à droite,
//  - la boîte du centre pivote en 3D pour "regarder" la souris, avec un reflet
//    lumineux qui suit le curseur et un éclat de brillance qui balaie la jaquette.
// Un clic sur une boîte ouvre ses détails (voir GameDetails.tsx) : on lance le jeu avec le bouton « Jouer »
// sous le carrousel (plus de double-clic : ça provoquait trop de lancements par erreur).
// Les styles sont dans styles.css (section "Carrousel" et "Boîte de jeu").

import { useRef, type CSSProperties, type PointerEvent } from 'react'
import type { Game } from '@shared/types'

interface Props {
  game: Game
  /** Écart avec le jeu sélectionné : 0 = au centre, -1 = juste à gauche, 1 = juste à droite... */
  offset: number
  onSelect: () => void
}

/** Inclinaison maximale (en degrés) quand la souris est au bord de la boîte. */
const MAX_TILT_LEFT_RIGHT = 24
const MAX_TILT_UP_DOWN = 14

/** Au-delà de cette distance du centre, les boîtes sont cachées (pour garder l'appli fluide). */
const MAX_VISIBLE_DISTANCE = 16

/** Couleur stable calculée à partir du nom (pour les boîtes sans jaquette). */
function colorFromName(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/** Durée pendant laquelle un jeu est considéré comme "nouveau" : 24 heures, en millisecondes. */
const NEW_GAME_DURATION_MS = 24 * 60 * 60 * 1000

/** Vrai si le jeu a été ajouté à la bibliothèque il y a moins de 24 heures. */
function isNewGame(addedAt: string): boolean {
  const addedTime = new Date(addedAt).getTime()
  // Date invalide ou absente : on n'affiche pas le badge
  if (Number.isNaN(addedTime)) return false
  return Date.now() - addedTime < NEW_GAME_DURATION_MS
}

/**
 * Rotation 3D qui suit la souris (seulement pour la boîte du centre).
 * On écrit directement des variables CSS sur l'élément (sans passer par React)
 * pour que l'animation reste fluide.
 */
function useMouseTilt(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const frame = useRef(0)

  function reset() {
    const element = ref.current
    if (!element) return
    cancelAnimationFrame(frame.current)
    // On retire les valeurs : la boîte revient doucement à sa position de repos
    for (const name of ['--tilt-x', '--tilt-y', '--glare-x', '--glare-y']) {
      element.style.removeProperty(name)
    }
    element.classList.remove('tilting')
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const element = ref.current
    if (!element || !enabled) return
    const rect = element.getBoundingClientRect()
    // Position de la souris dans la boîte : 0 = bord gauche/haut, 1 = bord droit/bas
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))

    // Une seule mise à jour par image affichée (évite de surcharger le navigateur)
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      // Le côté où se trouve la souris vient vers nous
      element.style.setProperty('--tilt-y', `${((0.5 - x) * 2 * MAX_TILT_LEFT_RIGHT).toFixed(2)}deg`)
      element.style.setProperty('--tilt-x', `${((y - 0.5) * 2 * MAX_TILT_UP_DOWN).toFixed(2)}deg`)
      // Position du reflet lumineux, en pourcentage de la jaquette
      element.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`)
      element.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`)
      element.classList.add('tilting')
    })
  }

  return { ref, onPointerMove, onPointerLeave: reset }
}

export default function GameBox({ game, offset, onSelect }: Props) {
  const selected = offset === 0
  const distance = Math.abs(offset)
  const hue = colorFromName(game.name)
  const coverUrl = game.coverFile ? `cover://img/${encodeURIComponent(game.coverFile)}` : null
  const tilt = useMouseTilt(selected)

  // Variables CSS qui placent la boîte dans le carrousel (voir ".cf-item" dans styles.css)
  const style = {
    '--hue': hue,
    '--side': Math.sign(offset), // -1 = à gauche, 0 = au centre, 1 = à droite
    '--dist': distance, // distance au centre (0, 1, 2...)
    zIndex: 1000 - distance, // les boîtes proches du centre passent devant
    visibility: distance > MAX_VISIBLE_DISTANCE ? 'hidden' : undefined,
  } as CSSProperties

  return (
    <div className={`cf-item${selected ? ' selected' : ''}${game.installed === false ? ' not-installed' : ''}`} style={style}>
      {/* Toute la boîte est cliquable : un clic ouvre ses détails (succès, fiche Steam…) */}
      <div
        ref={tilt.ref}
        className="box-wrap"
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        onClick={onSelect}
        title={`${game.name} — clic pour voir les détails`}
      >
        {/* Enveloppe qui fait flotter doucement la boîte du centre */}
        <div className="box-float">
          {/* Lueur colorée derrière la boîte (une copie floutée de la jaquette) */}
          <div className="box-ambient" aria-hidden="true">
            {coverUrl ? <img src={coverUrl} alt="" draggable={false} /> : <div className="box-ambient-color" />}
          </div>

          <div className="box">
            <div className="box-spine">
              <span>{game.name}</span>
            </div>
            <div className="box-spine box-spine-right">
              <span>{game.name}</span>
            </div>
            <div className="box-top" />
            <div className="box-bottom" />
            <div className="box-front">
              {coverUrl ? (
                <img src={coverUrl} alt={game.name} draggable={false} />
              ) : (
                <div className="box-generic">
                  <span className="box-generic-title">{game.name}</span>
                </div>
              )}
              {/* Couches de lumière, de la plus discrète à la plus visible */}
              <div className="box-shine" />
              <div className="box-sheen" />
              <div className="box-glare" />
              {/* Assombrit les boîtes éloignées du centre */}
              <div className="box-shade" />
              {/* Badge "NOUVEAU" en haut à droite pour les jeux ajoutés il y a moins de 24 h */}
              {isNewGame(game.addedAt) && <span className="box-badge-new">NOUVEAU</span>}
              {/* Jeu de la bibliothèque Steam pas installé : jaquette grisée + badge */}
              {game.installed === false && <span className="box-badge-not-installed">NON INSTALLÉ</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
