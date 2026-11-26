// L'étagère : la grille de boîtes de jeux.
import { forwardRef, useEffect, useRef } from 'react'
import type { Game } from '@shared/types'
import GameBox from './GameBox'

interface Props {
  games: Game[]
  selectedIndex: number
  onSelect: (index: number) => void
  onLaunch: (index: number) => void
}

const Shelf = forwardRef<HTMLDivElement, Props>(function Shelf({ games, selectedIndex, onSelect, onLaunch }, ref) {
  const innerRef = useRef<HTMLDivElement | null>(null)

  // Fait défiler l'étagère pour que la boîte sélectionnée reste visible
  useEffect(() => {
    const cell = innerRef.current?.children[selectedIndex] as HTMLElement | undefined
    cell?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

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
    <div
      className="shelf"
      ref={(node) => {
        innerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
    >
      {games.map((game, index) => (
        <GameBox
          key={game.id}
          game={game}
          selected={index === selectedIndex}
          onSelect={() => onSelect(index)}
          onLaunch={() => onLaunch(index)}
        />
      ))}
    </div>
  )
})

export default Shelf
