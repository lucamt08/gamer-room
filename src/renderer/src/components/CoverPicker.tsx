// Choix de la jaquette via SteamGridDB, en 2 étapes :
//  1. choisir le bon jeu dans les résultats de recherche ;
//  2. choisir la jaquette parmi celles proposées.
// Si le nom tapé ne donne rien (faute de frappe, nom de fichier, abréviation...), l'appli
// essaie toute seule des orthographes corrigées et propose le nom officiel le plus probable.
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
  /** Ce qui avait été tapé, et l'orthographe corrigée qui a donné des résultats (sinon null). */
  const [correction, setCorrection] = useState<{ typed: string; corrected: string } | null>(null)
  const [chosen, setChosen] = useState<SgdbGame | null>(null)
  const [grids, setGrids] = useState<SgdbGrid[] | null>(null)
  /** Renommer aussi le jeu avec le nom officiel trouvé ? */
  const [renameGame, setRenameGame] = useState(false)
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
      const found = await window.api.sgdbSearch(term)
      setResults(found.results)
      setCorrection(found.correctedTerm ? { typed: term, corrected: found.correctedTerm } : null)
    })

  const choose = (result: SgdbGame): Promise<void> =>
    run(async () => {
      setChosen(result)
      // Si le nom a dû être corrigé, on propose par défaut de renommer le jeu avec le nom officiel
      setRenameGame(correction !== null && result.name.toLowerCase() !== game.name.toLowerCase())
      setGrids(await window.api.sgdbGrids(result.id))
    })

  const apply = (grid: SgdbGrid): Promise<void> =>
    run(async () => {
      let updated = await window.api.sgdbSetCover(game.id, grid.url, chosen!.id)
      if (renameGame) updated = await window.api.updateGame(game.id, { name: chosen!.name })
      onApplied(updated)
    })

  // Recherche lancée automatiquement à l'ouverture si on n'a pas déjà des résultats
  useEffect(() => {
    if (!initialResults) search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Le jeu le plus ressemblant (les résultats corrigés sont triés du plus au moins ressemblant)
  const suggestion = correction && results && results.length > 0 ? results[0] : null
  const nameDiffers = chosen !== null && chosen.name.toLowerCase() !== game.name.toLowerCase()

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
          {/* Le nom tapé ne donnait rien : on propose le nom officiel le plus probable */}
          {suggestion && correction && (
            <div className="name-suggestion">
              <p>
                Aucun résultat pour « {correction.typed} ». Tu voulais dire :
              </p>
              <button className="btn btn-primary" onClick={() => choose(suggestion)}>
                {suggestion.name} {suggestion.year && `(${suggestion.year})`}
              </button>
            </div>
          )}

          <p className="hint">
            {results.length === 0
              ? 'Aucun résultat, même en corrigeant le nom. Essaie un autre nom (ex. le nom affiché sur Steam).'
              : suggestion
                ? 'Sinon, choisis le bon jeu dans la liste :'
                : 'Quel est le bon jeu ?'}
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

          {/* Proposition de corriger aussi le nom du jeu dans la bibliothèque */}
          {nameDiffers && grids.length > 0 && (
            <label className="rename-option">
              <input type="checkbox" checked={renameGame} onChange={(e) => setRenameGame(e.target.checked)} />
              Renommer aussi le jeu en « {chosen.name} »
            </label>
          )}

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
