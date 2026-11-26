// Écran de chargement affiché entre le clic sur "Jouer" et l'ouverture du jeu en plein écran.
// Pendant ce temps, le hub démarre le jeu (ou son launcher / Steam) et attend la fenêtre du jeu.
import type { Game, RunningState } from '@shared/types'
import { shouldSkipLauncher } from '@shared/launch'

interface Props {
  game: Game | undefined
  phase: RunningState['phase']
  onCancel: () => void
}

/** Texte affiché sous le nom du jeu, selon l'étape du lancement. */
function phaseText(game: Game | undefined, phase: RunningState['phase']): string {
  if (phase === 'flawless') return 'Activation du correctif Flawless Widescreen…'
  if (phase === 'launcher') return 'Le launcher est ouvert : clique sur « Jouer » pour démarrer le jeu'
  if (game?.launchKind === 'steam') return 'Steam démarre le jeu…'
  if (game?.launchKind === 'launcher' && !shouldSkipLauncher(game)) return 'Ouverture du launcher…'
  return 'Lancement du jeu…'
}

export default function LoadingScreen({ game, phase, onCancel }: Props) {
  const coverUrl = game?.coverFile ? `cover://img/${encodeURIComponent(game.coverFile)}` : null

  return (
    <div className="loading-screen" role="status" aria-live="polite">
      {/* Fond : la jaquette floutée et agrandie */}
      {coverUrl && <div className="loading-bg" style={{ backgroundImage: `url("${coverUrl}")` }} />}

      <div className="loading-content">
        <div className="loading-cover">
          {coverUrl ? <img src={coverUrl} alt="" /> : <span>{game?.name.charAt(0) ?? '?'}</span>}
          <div className="loading-shine" />
        </div>
        <h2 className="loading-title">{game?.name ?? 'Jeu'}</h2>
        <div className="loading-bar">
          <div className="loading-bar-fill" />
        </div>
        <p className="loading-text">{phaseText(game, phase)}</p>
        <button className="btn btn-ghost loading-cancel" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  )
}
