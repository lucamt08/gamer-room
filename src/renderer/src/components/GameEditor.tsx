// Écran "Modifier" : nom, arguments, option plein écran, temps de jeu de départ,
// correctif Flawless Widescreen, suppression.
import { forwardRef, useState } from 'react'
import type { Game, GamePatch } from '@shared/types'
import { formatPlaytime, playtimeFromSteam } from '@shared/playtime'
import { canSkipLauncher, shouldSkipLauncher } from '@shared/launch'
import Modal from './Modal'
import FlawlessOption from './FlawlessOption'

interface Props {
  game: Game
  onClose: () => void
  onSaved: (game: Game) => void
  onRemoved: (id: string) => void
  onChangeCover: () => void
}

const GameEditor = forwardRef<HTMLDivElement, Props>(function GameEditor(
  { game, onClose, onSaved, onRemoved, onChangeCover },
  ref
) {
  const [name, setName] = useState(game.name)
  const [args, setArgs] = useState(game.args)
  const [forceFullscreen, setForceFullscreen] = useState(game.forceFullscreen)
  const [skipLauncher, setSkipLauncher] = useState(shouldSkipLauncher(game))
  // Temps de jeu déjà joué (valeur de départ du compteur), en heures + minutes
  const startSeconds = game.playtimeSeconds ?? 0
  const [hours, setHours] = useState(String(Math.floor(startSeconds / 3600)))
  const [minutes, setMinutes] = useState(String(Math.floor((startSeconds % 3600) / 60)))
  const [playtimeChanged, setPlaytimeChanged] = useState(false)
  const [fwsModule, setFwsModule] = useState(game.fwsModule ?? 'auto')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    try {
      // L'option "sauter le launcher" n'est envoyée que pour les launchers dont on connaît le vrai jeu
      const patch: GamePatch = canSkipLauncher(game)
        ? { name, args, forceFullscreen, skipLauncher }
        : { name, args, forceFullscreen }
      if (fwsModule !== (game.fwsModule ?? 'auto')) patch.fwsModule = fwsModule
      // Le temps de jeu n'est envoyé que s'il a été modifié : sinon on écraserait le temps
      // compté pendant que cet écran était ouvert
      if (playtimeChanged) {
        const h = Math.max(0, Math.floor(Number(hours) || 0))
        const m = Math.min(59, Math.max(0, Math.floor(Number(minutes) || 0)))
        patch.playtimeSeconds = h * 3600 + m * 60
      }
      onSaved(await window.api.updateGame(game.id, patch))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const remove = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true) // premier clic : on demande confirmation
      return
    }
    await window.api.removeGame(game.id)
    onRemoved(game.id)
  }

  return (
    <Modal title="Modifier le jeu" onClose={onClose} ref={ref}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label>
          Nom affiché
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Arguments de lancement <span className="hint">(optionnel, ex. -windowed)</span>
          <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="Aucun" />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={forceFullscreen} onChange={(e) => setForceFullscreen(e.target.checked)} />
          Forcer le plein écran sans bordure au lancement
        </label>
        {playtimeFromSteam(game) ? (
          <p className="hint">
            Temps de jeu : {formatPlaytime((game.steamPlaytimeMinutes ?? 0) * 60) || 'moins d’une minute'}, importé
            de Steam automatiquement.
          </p>
        ) : (
          <label>
            Temps de jeu déjà joué <span className="hint">(le compteur continue à partir de cette valeur)</span>
            <span className="playtime-inputs">
              <input
                type="number"
                min={0}
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value)
                  setPlaytimeChanged(true)
                }}
                aria-label="Heures"
              />
              h
              <input
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(e) => {
                  setMinutes(e.target.value)
                  setPlaytimeChanged(true)
                }}
                aria-label="Minutes"
              />
              min
            </span>
          </label>
        )}
        <FlawlessOption gameId={game.id} value={fwsModule} onChange={setFwsModule} />
        {canSkipLauncher(game) && (
          <label className="checkbox">
            <input type="checkbox" checked={skipLauncher} onChange={(e) => setSkipLauncher(e.target.checked)} />
            Lancer le jeu directement, sans ouvrir son launcher
          </label>
        )}
        <p className="hint path" title={game.exePath}>
          {game.exePath}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-danger" onClick={remove}>
            {confirmDelete ? 'Confirmer la suppression' : 'Supprimer'}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onChangeCover}>
            Changer la jaquette
          </button>
          <button type="submit" className="btn btn-primary">
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  )
})

export default GameEditor
