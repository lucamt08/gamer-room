// Fenêtre "Ajouter des jeux Steam" : liste les jeux Steam installés, on coche, on ajoute.
import { forwardRef, useEffect, useState } from 'react'
import type { Game, SteamGameEntry } from '@shared/types'
import Modal from './Modal'
import { cleanError } from '../utils'

interface Props {
  onClose: () => void
  /** Appelé avec les jeux ajoutés (l'appli cherche ensuite leurs jaquettes). */
  onAdded: (games: Game[]) => void
}

const SteamImport = forwardRef<HTMLDivElement, Props>(function SteamImport({ onClose, onAdded }, ref) {
  const [games, setGames] = useState<SteamGameEntry[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Au chargement : on lit la liste des jeux Steam installés. Tout est coché, sauf ceux déjà ajoutés.
  useEffect(() => {
    window.api
      .steamListGames()
      .then((list) => {
        setGames(list)
        setChecked(new Set(list.filter((g) => !g.alreadyAdded).map((g) => g.appId)))
      })
      .catch((e) => setError(cleanError(e)))
  }, [])

  const toggle = (appId: number): void =>
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })

  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      onAdded(await window.api.steamAddGames([...checked]))
    } catch (e) {
      setError(cleanError(e))
      setBusy(false)
    }
  }

  const available = games?.filter((g) => !g.alreadyAdded) ?? []

  return (
    <Modal title="Ajouter des jeux Steam" onClose={onClose} ref={ref}>
      {games === null && !error && <p className="hint">Recherche des jeux Steam installés…</p>}
      {games !== null && games.length === 0 && <p className="hint">Aucun jeu Steam installé trouvé sur ce PC.</p>}

      {games !== null && games.length > 0 && (
        <>
          <div className="steam-tools">
            <span className="hint">
              {available.length} jeu{available.length > 1 ? 'x' : ''} disponible{available.length > 1 ? 's' : ''}
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={() => setChecked(new Set(available.map((g) => g.appId)))}>
              Tout cocher
            </button>
            <button className="btn btn-ghost" onClick={() => setChecked(new Set())}>
              Tout décocher
            </button>
          </div>
          <ul className="steam-list">
            {games.map((game) => (
              <li key={game.appId}>
                <label className={`checkbox${game.alreadyAdded ? ' disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={game.alreadyAdded || checked.has(game.appId)}
                    disabled={game.alreadyAdded}
                    onChange={() => toggle(game.appId)}
                  />
                  <span className="steam-name">{game.name}</span>
                  {game.alreadyAdded && <span className="hint">déjà ajouté</span>}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Annuler
        </button>
        <button className="btn btn-primary" onClick={add} disabled={busy || checked.size === 0}>
          {busy ? 'Ajout…' : `Ajouter (${checked.size})`}
        </button>
      </div>
    </Modal>
  )
})

export default SteamImport
