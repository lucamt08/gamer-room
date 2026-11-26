// Menu en jeu : panneau sur le côté droit, ouvert par un appui long sur le bouton Xbox / PS.
// Il s'affiche dans sa propre fenêtre transparente par-dessus le jeu (voir main/gameOverlay.ts).
// Navigation : haut/bas pour choisir, A (croix) pour valider, B (rond) ou le bouton Xbox / PS pour fermer.
import { useEffect, useState } from 'react'
import type { OverlayAction, OverlayInfo } from '@shared/types'
import type { NavAction } from '../input/actions'
import { useGamepad } from '../input/useGamepad'
import { useKeyboard } from '../input/useKeyboard'
import { DEFAULT_SCROLL_SETTINGS } from '@shared/scroll'

interface MenuItem {
  action: OverlayAction
  label: string
  icon: string
  danger?: boolean
}

const ITEMS: MenuItem[] = [
  { action: 'resume', label: 'Reprendre le jeu', icon: '▶' },
  { action: 'fullscreen', label: 'Remettre en plein écran', icon: '⛶' },
  { action: 'quit', label: 'Quitter le jeu', icon: '✕', danger: true }
]

/** Durée écoulée lisible : "42 min", "1 h 05". */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

export default function GameOverlay() {
  const [info, setInfo] = useState<OverlayInfo | null>(null)
  const [selected, setSelected] = useState(0)
  /** « Quitter le jeu » a été choisi une fois : on attend la confirmation. */
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [now, setNow] = useState(Date.now())

  // Le main nous prévient à chaque ouverture : on repart du haut du menu
  useEffect(
    () =>
      window.api.onOverlayOpened((opened) => {
        setInfo(opened)
        setSelected(0)
        setConfirmQuit(false)
        setNow(Date.now())
      }),
    []
  )

  // Horloge et durée de la partie, mises à jour chaque seconde
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const choose = (item: MenuItem): void => {
    if (item.action === 'quit' && !confirmQuit) {
      setConfirmQuit(true) // il faut valider une 2e fois pour quitter (évite les accidents)
      return
    }
    window.api.overlayAction(item.action)
  }

  const onAction = (action: NavAction): void => {
    switch (action) {
      case 'up':
        setSelected((i) => (i - 1 + ITEMS.length) % ITEMS.length)
        setConfirmQuit(false)
        break
      case 'down':
        setSelected((i) => (i + 1) % ITEMS.length)
        setConfirmQuit(false)
        break
      case 'confirm':
        choose(ITEMS[selected])
        break
      case 'back':
        window.api.overlayAction('resume')
        break
    }
  }
  useKeyboard(onAction, true)
  useGamepad(onAction, true, {
    speed: DEFAULT_SCROLL_SETTINGS.gamepadSpeed,
    acceleration: DEFAULT_SCROLL_SETTINGS.gamepadAcceleration
  })

  const game = info?.game
  const coverUrl = game?.coverFile ? `cover://img/${encodeURIComponent(game.coverFile)}` : null
  const clock = new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="game-overlay">
      {/* Partie gauche : le jeu reste visible, assombri. Un clic dessus ferme le menu. */}
      <div className="game-overlay-backdrop" onClick={() => window.api.overlayAction('resume')} />

      <aside className="game-overlay-panel">
        <div className="game-overlay-clock">{clock}</div>

        <div className="game-overlay-game">
          <div className="game-overlay-cover">
            {coverUrl ? <img src={coverUrl} alt="" /> : <span>{game?.name.charAt(0) ?? '?'}</span>}
          </div>
          <div>
            <h2>{game?.name ?? 'Jeu en cours'}</h2>
            {info && <p className="hint">En jeu depuis {formatDuration(now - info.startedAt)}</p>}
          </div>
        </div>

        <nav className="game-overlay-menu">
          {ITEMS.map((item, index) => (
            <button
              key={item.action}
              className={`game-overlay-item${index === selected ? ' selected' : ''}${item.danger ? ' danger' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onClick={() => choose(item)}
            >
              <span className="game-overlay-icon">{item.icon}</span>
              {item.action === 'quit' && confirmQuit ? 'Valide encore pour quitter' : item.label}
            </button>
          ))}
        </nav>

        <div className="game-overlay-help">
          <kbd>A</kbd> valider · <kbd>B</kbd> fermer · maintiens <kbd>Xbox</kbd>/<kbd>PS</kbd> pour fermer
        </div>
      </aside>
    </div>
  )
}
