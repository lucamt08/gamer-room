// Choix de la jaquette via SteamGridDB, en 2 étapes :
//  1. choisir le bon jeu dans les résultats de recherche ;
//  2. choisir la jaquette parmi celles proposées.
import { forwardRef, useEffect, useState } from 'react'
import type { Game, SgdbGame, SgdbGrid } from '@shared/types'
import Modal from './Modal'

interface Props {
  game: Game
  /** Résultats déjà connus (recherche automatique), pour éviter de rechercher à nouveau. */
  initialResults?: SgdbGame[]
  onClose: () => void
  onApplied: (game: Game) => void
}

const CoverPicker = forwardRef<HTMLDivElement, Props>(function CoverPicker(
  { game, initialResults, onClose, onApplied },
  ref
) {
  const [term, setTerm] = useState(game.name)
  const [results, setResults] = useState<SgdbGame[] | null>(initialResults ?? null)
  const [chosen, setChosen] = useState<SgdbGame | null>(null)
  const [grids, setGrids] = useState<SgdbGrid[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Exécute une tâche asynchrone en gérant "chargement" et erreurs. */
  const run = async (task: () => Promise<void>): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setLoading(false)
    }
  }

  const search = (): Promise<void> =>
    run(async () => {
      setChosen(null)
      setGrids(null)
      setResults(await window.api.sgdbSearch(term))
    })

  const choose = (result: SgdbGame): Promise<void> =>
    run(async () => {
      setChosen(result)
      setGrids(await window.api.sgdbGrids(result.id))
    })

  const apply = (grid: SgdbGrid): Promise<void> =>
    run(async () => {
      onApplied(await window.api.sgdbSetCover(game.id, grid.url, chosen!.id))
    })

  // Recherche lancée automatiquement à l'ouverture si on n'a pas déjà des résultats
  useEffect(() => {
    if (!initialResults) search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal title={`Jaquette — ${game.name}`} onClose={onClose} ref={ref}>
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault()
          search()
        }}
      >
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Nom du jeu" />
        <button type="submit" className="btn">
          Rechercher
        </button>
      </form>

      {loading && <p className="hint">Chargement…</p>}
      {error && <p className="error">{error}</p>}

      {!chosen && results && (
        <>
          <p className="hint">
            {results.length === 0 ? 'Aucun résultat. Essaie un autre nom.' : 'Quel est le bon jeu ?'}
          </p>
          <div className="result-list">
            {results.map((r) => (
              <button key={r.id} className="btn result" onClick={() => choose(r)}>
                {r.name} {r.year && <span className="hint">({r.year})</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {chosen && grids && (
        <>
          <p className="hint">
            <button className="btn btn-ghost" onClick={() => setChosen(null)}>
              ← Autres jeux
            </button>{' '}
            {grids.length === 0 ? `Aucune jaquette 600x900 pour « ${chosen.name} ».` : `Choisis une jaquette :`}
          </p>
          <div className="grid-list">
            {grids.map((g) => (
              <button key={g.id} className="grid-thumb" onClick={() => apply(g)}>
                <img src={g.thumb} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
})

export default CoverPicker
