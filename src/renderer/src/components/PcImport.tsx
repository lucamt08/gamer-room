// Fenêtre "Jeux du PC" : les jeux trouvés sur le PC hors Steam, pas encore dans Gamer Room.
//  - Epic Games, Battle.net, GOG : lus dans leurs launchers (sûrs, cochés) ;
//  - « Autres jeux détectés » : la détection générale des .exe (voir pcGameDetect.ts). Les plus sûrs sont
//    cochés, les autres sont « à vérifier » (décochés), avec la raison de la détection.
// On peut ajouter un dossier où chercher (ex. E:\MesJeux) : la recherche est relancée.
import { forwardRef, useEffect, useState } from 'react'
import type { DetectedGame, Game, GameSource } from '@shared/types'
import { formatSize } from '@shared/playtime'
import Modal from './Modal'
import { cleanError } from '../utils'

interface Props {
  onClose: () => void
  /** Appelé avec les jeux ajoutés (l'appli cherche ensuite leurs jaquettes). */
  onAdded: (games: Game[]) => void
}

type Result = { games: DetectedGame[]; alreadyAdded: number }

/** Titre de chaque section, dans l'ordre d'affichage. */
const SECTIONS: { source: GameSource; title: string }[] = [
  { source: 'epic', title: 'Epic Games' },
  { source: 'battlenet', title: 'Battle.net' },
  { source: 'gog', title: 'GOG' },
  { source: 'pc', title: 'Autres jeux détectés' }
]

/** Petit texte à droite du nom. Ex. "48,2 Go", "non installé" ou "moteur Unity · reconnu comme jeu par Windows". */
function details(game: DetectedGame): string {
  if (game.installed === false) return 'non installé'
  if (game.source !== 'pc') return formatSize(game.sizeBytes)
  return (game.confidence === 'medium' ? 'à vérifier · ' : '') + game.reasons.join(' · ')
}

const PcImport = forwardRef<HTMLDivElement, Props>(function PcImport({ onClose, onAdded }, ref) {
  const [result, setResult] = useState<Result | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Affiche un résultat de recherche : les jeux sûrs sont cochés, les "à vérifier" non. */
  const show = (found: Result): void => {
    setResult(found)
    setChecked(new Set(found.games.filter((g) => g.confidence === 'high').map((g) => g.key)))
  }

  useEffect(() => {
    window.api.pcListGames().then(show, (e) => setError(cleanError(e)))
  }, [])

  const toggle = (key: string): void =>
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const addFolder = async (): Promise<void> => {
    setBusy(true)
    try {
      show(await window.api.pcAddFolder())
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      onAdded(await window.api.pcAddGames([...checked]))
    } catch (e) {
      setError(cleanError(e))
      setBusy(false)
    }
  }

  const games = result?.games ?? []

  return (
    <Modal title="Jeux du PC" onClose={onClose} ref={ref}>
      {result === null && !error && <p className="hint">Recherche des jeux sur ton PC…</p>}

      {result !== null && (
        <>
          <div className="steam-tools">
            <span className="hint">
              {games.length === 0
                ? 'Aucun nouveau jeu trouvé.'
                : `${games.length} nouveau${games.length > 1 ? 'x' : ''} jeu${games.length > 1 ? 'x' : ''}`}
              {result.alreadyAdded > 0 && ` · ${result.alreadyAdded} déjà dans Gamer Room`}
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={addFolder} disabled={busy} title="Chercher aussi dans un dossier où tu ranges tes jeux">
              + Dossier de jeux…
            </button>
          </div>

          {SECTIONS.map(({ source, title }) => {
            // Les jeux installés d'abord, puis ceux de la bibliothèque pas installés (Epic)
            const list = games
              .filter((g) => g.source === source)
              .sort((a, b) => Number(a.installed === false) - Number(b.installed === false))
            if (list.length === 0) return null
            return (
              <div key={source}>
                <h3 className="form-section">
                  {title} ({list.length})
                </h3>
                <ul className="steam-list">
                  {list.map((game) => (
                    <li key={game.key}>
                      <label className="checkbox" title={game.exePath}>
                        <input type="checkbox" checked={checked.has(game.key)} onChange={() => toggle(game.key)} />
                        <span className="steam-name">{game.name}</span>
                        <span className="hint">{details(game)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          {games.some((g) => g.source === 'pc') && (
            <p className="hint">
              « Autres jeux détectés » : Gamer Room devine que ce sont des jeux (moteur de jeu, liste de jeux de
              Windows…). Vérifie avant d'ajouter. Tu pourras corriger le nom dans « Modifier ».
            </p>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          {games.length === 0 ? 'Fermer' : 'Annuler'}
        </button>
        {games.length > 0 && (
          <button className="btn btn-primary" onClick={add} disabled={busy || checked.size === 0}>
            {busy ? 'Patiente…' : `Ajouter (${checked.size})`}
          </button>
        )}
      </div>
    </Modal>
  )
})

export default PcImport
