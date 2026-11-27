// Le carrousel : une rangée de boîtes de jeux, le jeu sélectionné au centre et de face,
// les autres rangés de chaque côté, posés sur un sol brillant qui les reflète.
// Navigation : flèches / manette (gérées dans App.tsx), molette de la souris (voir input/useWheelScroll.ts)
// ou glisser à la souris (voir input/useDragScroll.ts). Un clic sur une boîte de côté la met au centre ;
// un clic sur la boîte du centre ouvre ses détails (GameDetails.tsx).
// On lance un jeu avec le bouton « Jouer » (dans App.tsx).
import { forwardRef, useEffect, useRef } from 'react'
import type { Game } from '@shared/types'
import type { ScrollSettings } from '@shared/scroll'
import { useWheelScroll } from '../input/useWheelScroll'
import { useDragScroll } from '../input/useDragScroll'
import GameBox from './GameBox'

interface Props {
  games: Game[]
  selectedIndex: number
  onSelect: (index: number) => void
  /** Clic sur la boîte du centre : ouvre le panneau de détails de ce jeu (voir GameDetails.tsx). */
  onOpen: (index: number) => void
  /** Réglages de la molette et du glisser (venant des Paramètres). */
  scroll: ScrollSettings
}

const Shelf = forwardRef<HTMLDivElement, Props>(function Shelf({ games, selectedIndex, onSelect, onOpen, scroll }, ref) {
  // Jeu visé par la molette / le glisser. On le garde à part car plusieurs mouvements
  // peuvent arriver avant que l'interface ait eu le temps de se redessiner.
  const target = useRef(selectedIndex)
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    target.current = selectedIndex // la sélection a changé autrement (clavier, clic...)
    // Les boîtes viennent de bouger sous la souris immobile : sans ça, celle qui arrive sous
    // le curseur se croirait "survolée" et resterait soulevée. On coupe l'effet de survol
    // jusqu'à ce que la souris bouge vraiment (voir onPointerMove plus bas et styles.css).
    stage.current?.classList.add('scrolling')
  }, [selectedIndex])

  /** Avance de `steps` jeux (négatif = vers la gauche), sans sortir de la liste. */
  const moveBy = (steps: number): void => {
    const next = Math.min(games.length - 1, Math.max(0, target.current + steps))
    if (next === target.current) return
    target.current = next
    onSelect(next)
  }

  const onWheel = useWheelScroll({ speed: scroll.wheelLevel, acceleration: scroll.wheelAcceleration, moveBy })
  const drag = useDragScroll({ enabled: scroll.dragScroll, sensitivity: scroll.dragSensitivity, moveBy })

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
      ref={stage}
      className="cf-stage"
      onWheel={onWheel}
      {...drag}
      onPointerMove={(event) => {
        // La souris bouge (sans glisser) : on réactive l'effet de survol
        if (!event.currentTarget.classList.contains('dragging')) event.currentTarget.classList.remove('scrolling')
        drag.onPointerMove(event)
      }}
    >
      {/* Halo de lumière derrière le jeu du centre */}
      {/* La "key" change à chaque jeu : le halo est recréé et refait son petit flash (le cran) */}
      <div className="cf-light" key={selectedIndex} />
      {/* Les boîtes (ce bloc est reflété sous lui-même pour faire le sol brillant) */}
      <div className="cf-track" ref={ref}>
        {games.map((game, index) => (
          <GameBox
            key={game.id}
            game={game}
            offset={index - selectedIndex}
            // Clic sur le jeu du centre : ses détails. Clic sur un jeu de côté : on le met au centre.
            onSelect={() => {
              if (index === selectedIndex) return onOpen(index)
              target.current = index
              onSelect(index)
            }}
          />
        ))}
      </div>
      {/* Ligne d'horizon du sol */}
      <div className="cf-floor" />
    </div>
  )
})

export default Shelf
