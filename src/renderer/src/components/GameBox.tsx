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
          </div>
        </div>
      </button>
      <div className="box-label">{game.name}</div>
    </div>
  )
}
