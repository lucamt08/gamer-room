// Fenêtre "Jeux Steam" : synchronise Gamer Room avec la bibliothèque Steam.
// Elle liste les jeux de la bibliothèque qui ne sont PAS encore dans Gamer Room, installés ou non
// (nouveaux achats, jeux désinstallés mais déjà joués…). On coche, on ajoute.
// Les jeux déjà présents sont mis à jour tout seuls (installé ou non, taille) : voir steamInstalls.ts.
import { forwardRef, useEffect, useState } from 'react'
import type { Game, SteamGameEntry } from '@shared/types'
import { formatPlaytime, formatSize } from '@shared/playtime'
import Modal from './Modal'
import { cleanError } from '../utils'

interface Props {
  onClose: () => void
  /** Appelé avec les jeux ajoutés (l'appli cherche ensuite leurs jaquettes). */
  onAdded: (games: Game[]) => void
}

/** Petit texte à droite du nom : taille et temps de jeu. Ex. "48,2 Go · 98 h 32 de jeu". */
function details(game: SteamGameEntry): string {
  const size = formatSize(game.sizeBytes)
  const playtime = formatPlaytime(game.playtimeMinutes * 60)
  return [size && (game.installed ? size : `≈ ${size}`), playtime && `${playtime} de jeu`].filter(Boolean).join(' · ')
}

const SteamImport = forwardRef<HTMLDivElement, Props>(function SteamImport({ onClose, onAdded }, ref) {
  const [games, setGames] = useState<SteamGameEntry[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Au chargement : on lit la bibliothèque Steam. Tous les nouveaux jeux sont cochés.
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
  const alreadyCount = (games?.length ?? 0) - available.length
  const installed = available.filter((g) => g.installed)
  const notInstalled = available.filter((g) => !g.installed)

  /** Une section de la liste (jeux installés, ou non installés). */
  const section = (title: string, list: SteamGameEntry[]) =>
    list.length > 0 && (
      <>
        <h3 className="form-section">
          {title} ({list.length})
        </h3>
        <ul className="steam-list">
          {list.map((game) => (
            <li key={game.appId}>
              <label className="checkbox">
                <input type="checkbox" checked={checked.has(game.appId)} onChange={() => toggle(game.appId)} />
                <span className="steam-name">{game.name}</span>
                <span className="hint">{details(game)}</span>
              </label>
            </li>
          ))}
        </ul>
      </>
    )

  return (
    <Modal title="Jeux Steam" onClose={onClose} ref={ref}>
      {games === null && !error && <p className="hint">Lecture de ta bibliothèque Steam…</p>}
      {games !== null && games.length === 0 && <p className="hint">Aucun jeu Steam trouvé sur ce PC.</p>}

      {games !== null && games.length > 0 && (
        <>
          <div className="steam-tools">
            <span className="hint">
              {available.length === 0
                ? 'Tout est à jour : tous tes jeux Steam sont déjà dans Gamer Room.'
                : `${available.length} nouveau${available.length > 1 ? 'x' : ''} jeu${available.length > 1 ? 'x' : ''}`}
              {alreadyCount > 0 && available.length > 0 && ` · ${alreadyCount} déjà dans Gamer Room`}
            </span>
            <span className="spacer" />
            {available.length > 0 && (
              <>
                <button className="btn btn-ghost" onClick={() => setChecked(new Set(available.map((g) => g.appId)))}>
                  Tout cocher
                </button>
                <button className="btn btn-ghost" onClick={() => setChecked(new Set())}>
                  Tout décocher
                </button>
              </>
            )}
          </div>
          {section('Installés', installed)}
          {section('Non installés', notInstalled)}
          {notInstalled.length > 0 && (
            <p className="hint">
              Les jeux non installés apparaissent grisés : le bouton « Installer » ouvre l'installation dans Steam.
              Leur temps de jeu Steam reste affiché.
            </p>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          {available.length === 0 ? 'Fermer' : 'Annuler'}
        </button>
        {available.length > 0 && (
          <button className="btn btn-primary" onClick={add} disabled={busy || checked.size === 0}>
            {busy ? 'Ajout…' : `Ajouter (${checked.size})`}
          </button>
        )}
      </div>
    </Modal>
  )
})

export default SteamImport
