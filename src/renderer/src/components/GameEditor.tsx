// Écran "Modifier" : nom, arguments, option plein écran, suppression.
import { forwardRef, useState } from 'react'
import type { Game } from '@shared/types'
import Modal from './Modal'

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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    try {
      onSaved(await window.api.updateGame(game.id, { name, args, forceFullscreen }))
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
