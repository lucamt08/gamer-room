// Une boîte de jeu en "3D légère" (CSS uniquement) :
//  - une face avant (la jaquette),
//  - une tranche visible sur la gauche (avec le nom du jeu),
//  - une légère inclinaison, plus marquée quand la boîte est sélectionnée.
// Les styles sont dans styles.css (section "Boîte de jeu").

import type { CSSProperties } from 'react'
import type { Game } from '@shared/types'

interface Props {
  game: Game
  selected: boolean
  onSelect: () => void
  onLaunch: () => void
}

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

export default function GameBox({ game, selected, onSelect, onLaunch }: Props) {
  const hue = colorFromName(game.name)
  const style = { '--hue': hue } as CSSProperties
  const coverUrl = game.coverFile ? `cover://img/${encodeURIComponent(game.coverFile)}` : null

  return (
    <div className="shelf-cell">
      <button
        className={`box-wrap${selected ? ' selected' : ''}`}
        style={style}
        onMouseEnter={onSelect}
        onFocus={onSelect}
        onClick={onSelect}
        onDoubleClick={onLaunch}
        title={`${game.name} — double-clic pour jouer`}
        tabIndex={-1}
      >
        <div className="box">
          <div className="box-spine">
            <span>{game.name}</span>
          </div>
          <div className="box-front">
            {coverUrl ? (
              <img src={coverUrl} alt={game.name} draggable={false} />
            ) : (
              <div className="box-generic">
                <span className="box-generic-title">{game.name}</span>
              </div>
            )}
            <div className="box-shine" />
            {/* Badge "NOUVEAU" en haut à droite pour les jeux ajoutés il y a moins de 24 h */}
            {isNewGame(game.addedAt) && <span className="box-badge-new">NOUVEAU</span>}
          </div>
        </div>
      </button>
      <div className="box-label">{game.name}</div>
    </div>
  )
}
