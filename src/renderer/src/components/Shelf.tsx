// Le carrousel : une rangée de boîtes de jeux, le jeu sélectionné au centre et de face,
// les autres rangés de chaque côté, posés sur un sol brillant qui les reflète.
// Navigation : flèches / manette (gérées dans App.tsx), clic sur une boîte, ou molette de la souris.
import { forwardRef, useRef, type WheelEvent } from 'react'
import type { Game } from '@shared/types'
import GameBox from './GameBox'

interface Props {
  games: Game[]
  selectedIndex: number
  onSelect: (index: number) => void
  onLaunch: (index: number) => void
}

/** Délai minimum entre deux crans de molette (en ms), pour que le défilement reste lisible. */
const WHEEL_DELAY_MS = 90

const Shelf = forwardRef<HTMLDivElement, Props>(function Shelf({ games, selectedIndex, onSelect, onLaunch }, ref) {
  const lastWheel = useRef(0)

  // Molette : un cran = un jeu vers la gauche ou la droite
  const onWheel = (event: WheelEvent): void => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (delta === 0 || event.timeStamp - lastWheel.current < WHEEL_DELAY_MS) return
    lastWheel.current = event.timeStamp
    const next = selectedIndex + (delta > 0 ? 1 : -1)
    if (next >= 0 && next < games.length) onSelect(next)
  }

  if (games.length === 0) {
    return (
      <div className="shelf-empty">
        <p className="shelf-empty-title">Ta bibliothèque est vide</p>
        <p>
          Clique sur <strong>+ Ajouter</strong> ou glisse un <code>.exe</code> / raccourci <code>.lnk</code> dans
          la fenêtre.
        </p>
      </div>
    )
  }

  return (
    <div className="cf-stage" onWheel={onWheel}>
      {/* Halo de lumière derrière le jeu du centre */}
      <div className="cf-light" />
      {/* Les boîtes (ce bloc est reflété sous lui-même pour faire le sol brillant) */}
      <div className="cf-track" ref={ref}>
        {games.map((game, index) => (
          <GameBox
            key={game.id}
            game={game}
            offset={index - selectedIndex}
            onSelect={() => onSelect(index)}
            onLaunch={() => onLaunch(index)}
          />
        ))}
      </div>
      {/* Ligne d'horizon du sol */}
      <div className="cf-floor" />
    </div>
  )
})

export default Shelf
