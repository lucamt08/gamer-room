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
  /** « Quitter le jeu » a été choisi : on affiche la question « Es-tu sûr ? » (Oui / Non). */
  const [confirmQuit, setConfirmQuit] = useState(false)
  /** Réponse choisie dans la question : 0 = Oui, 1 = Non (Non par défaut, pour éviter les accidents). */
  const [answer, setAnswer] = useState(1)
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
    if (item.action === 'quit') {
      setAnswer(1) // « Non » choisi d'avance
      setConfirmQuit(true) // on demande confirmation avant de quitter
      return
    }
    window.api.overlayAction(item.action)
  }

  /** Réponse à « Es-tu sûr de vouloir quitter ? ». Oui = le jeu est fermé comme avec sa croix. */
  const answerQuit = (yes: boolean): void => {
    setConfirmQuit(false)
    if (yes) window.api.overlayAction('quit')
  }

  const onAction = (action: NavAction): void => {
    // Question « Es-tu sûr ? » affichée : gauche/droite (ou haut/bas) pour choisir Oui ou Non
    if (confirmQuit) {
      switch (action) {
        case 'left':
        case 'right':
        case 'up':
        case 'down':
          setAnswer((a) => 1 - a)
          break
        case 'confirm':
          answerQuit(answer === 0)
          break
        case 'back':
          answerQuit(false)
          break
      }
      return
    }
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
    // En fond : la dernière image du jeu (capturée juste avant l'ouverture), au cas où le jeu devient noir
    <div
      className="game-overlay"
      style={info?.background ? { backgroundImage: `url("${info.background}")` } : undefined}
    >
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

        {confirmQuit ? (
          // Confirmation : quitter depuis ici ferme la fenêtre du jeu (comme sa croix). Le jeu peut alors
          // ne pas sauvegarder : mieux vaut passer par son propre menu « Quitter ».
          <div className="game-overlay-confirm">
            <p>
              Il est conseillé de quitter le jeu <strong>depuis le jeu lui-même</strong> (pour être sûr que ta
              partie est sauvegardée).
            </p>
            <p>Es-tu sûr de vouloir quitter {game?.name ?? 'le jeu'} ?</p>
            <div className="game-overlay-confirm-buttons">
              <button
                className={`game-overlay-item danger${answer === 0 ? ' selected' : ''}`}
                onMouseEnter={() => setAnswer(0)}
                onClick={() => answerQuit(true)}
              >
                Oui
              </button>
              <button
                className={`game-overlay-item${answer === 1 ? ' selected' : ''}`}
                onMouseEnter={() => setAnswer(1)}
                onClick={() => answerQuit(false)}
              >
                Non
              </button>
            </div>
          </div>
        ) : (
          <nav className="game-overlay-menu">
            {ITEMS.map((item, index) => (
              <button
                key={item.action}
                className={`game-overlay-item${index === selected ? ' selected' : ''}${item.danger ? ' danger' : ''}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(item)}
              >
                <span className="game-overlay-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        )}

        <div className="game-overlay-help">
          <kbd>A</kbd> valider · <kbd>B</kbd> fermer · maintiens <kbd>Xbox</kbd>/<kbd>PS</kbd> pour fermer
        </div>
      </aside>
    </div>
  )
}
