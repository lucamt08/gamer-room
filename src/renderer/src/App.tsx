// Composant principal : l'étagère + les fenêtres modales + la navigation.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Game, RunningState, SgdbGame } from '@shared/types'
import { DEFAULT_SCROLL_SETTINGS, type ScrollSettings } from '@shared/scroll'
import Shelf from './components/Shelf'
import GameEditor from './components/GameEditor'
import CoverPicker from './components/CoverPicker'
import SettingsPanel from './components/SettingsPanel'
import UpdateBanner from './components/UpdateBanner'
import LoadingScreen from './components/LoadingScreen'
import SteamImport from './components/SteamImport'
import type { NavAction } from './input/actions'
import { useKeyboard } from './input/useKeyboard'
import { useGamepad } from './input/useGamepad'
import { handleModalNav } from './input/focusNav'
import { cleanError, countColumns } from './utils'
import { playTick } from './sound'

/**
 * Transforme la date du dernier lancement en texte lisible :
 * "Jamais joué", "Joué aujourd'hui", "Joué hier" ou "Joué il y a X jours".
 * On compte en jours "calendaires" (minuit à minuit), pas en tranches de 24 h.
 */
function formatLastPlayed(lastPlayedAt: string | null): string {
  if (!lastPlayedAt) return 'Jamais joué'
  const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(lastPlayedAt))) / 86_400_000)
  if (days <= 0) return "Joué aujourd'hui"
  if (days === 1) return 'Joué hier'
  return `Joué il y a ${days} jours`
}

/** Quelle fenêtre modale est ouverte (au plus une à la fois). */
type ModalState =
  | null
  | { kind: 'edit'; gameId: string }
  | { kind: 'cover'; gameId: string; results?: SgdbGame[] }
  | { kind: 'settings' }
  | { kind: 'steam' }

export default function App() {
  const [games, setGames] = useState<Game[]>([])
  const [selected, setSelected] = useState(0)
  const [modal, setModal] = useState<ModalState>(null)
  const [running, setRunning] = useState<RunningState>({ running: false, gameId: null })
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  // Réglages de défilement (molette, glisser, manette), mis à jour quand on enregistre les Paramètres
  const [scroll, setScroll] = useState<ScrollSettings>(DEFAULT_SCROLL_SETTINGS)

  const shelfRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // --- Chargement initial + écoute de l'état "jeu en cours" ---
  useEffect(() => {
    window.api.getGames().then(setGames)
    window.api.getSettings().then(setScroll)
    // Un jeu corrigé en arrière-plan au démarrage (ex. "Longshot" → son vrai nom et sa jaquette)
    const stopGameUpdates = window.api.onGameUpdated(replaceGame)
    const stopRunning = window.api.onRunningState((state) => {
      setRunning(state)
      if (state.message) showToast(state.message)
      // Le lancement a appris quelque chose (vrai nom, jaquette…) : on met le jeu à jour
      if (state.game) replaceGame(state.game)
      // Quand un jeu se ferme, on recharge la liste pour avoir la date de dernier lancement à jour
      if (!state.running) window.api.getGames().then(setGames)
    })
    return () => {
      stopGameUpdates()
      stopRunning()
    }
  }, [])

  // Le toast disparaît tout seul après 4 s
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const showToast = (text: string, error = false): void => setToast({ text, error })

  /** Remplace un jeu dans la liste (après modification). */
  const replaceGame = (game: Game): void => setGames((list) => list.map((g) => (g.id === game.id ? game : g)))

  const selectedGame: Game | undefined = games[selected]

  // --- Actions principales ---
  const launch = useCallback(
    async (game: Game | undefined) => {
      if (!game || running.running) return
      try {
        await window.api.launchGame(game.id)
      } catch (e) {
        showToast(cleanError(e), true)
      }
    },
    [running.running]
  )

  /** Ajoute des jeux à partir de chemins de fichiers, puis cherche leurs jaquettes. */
  const addPaths = async (paths: string[]): Promise<void> => {
    for (const path of paths) {
      try {
        const game = await window.api.addGame(path)
        setGames((list) => {
          setSelected(list.length) // on sélectionne le nouveau jeu
          return [...list, game]
        })
        showToast(`${game.name} ajouté`)
        await findCover(game)
      } catch (e) {
        showToast(cleanError(e), true)
      }
    }
  }

  /**
   * Recherche automatique de jaquette après un ajout.
   * `askIfUnsure` : ouvrir la fenêtre Jaquette quand plusieurs jeux correspondent
   * (désactivé pour l'import Steam de plusieurs jeux d'un coup).
   */
  const findCover = async (game: Game, askIfUnsure = true): Promise<void> => {
    const result = await window.api.sgdbAutoCover(game.id)
    switch (result.status) {
      case 'applied':
        replaceGame(result.game)
        break
      case 'multiple':
        if (askIfUnsure) setModal({ kind: 'cover', gameId: game.id, results: result.results })
        break
      case 'no-key':
        showToast('Astuce : ajoute ta clé SteamGridDB dans les Paramètres pour avoir les jaquettes.')
        break
      case 'error':
        showToast(result.message, true)
        break
      case 'none':
        break
    }
  }

  const pickAndAdd = async (): Promise<void> => {
    const path = await window.api.pickExecutable()
    if (path) await addPaths([path])
  }

  /** Jeux Steam ajoutés depuis la fenêtre d'import : on les affiche, puis on cherche leurs jaquettes. */
  const onSteamAdded = async (added: Game[]): Promise<void> => {
    setModal(null)
    if (added.length === 0) return
    setGames((list) => [...list, ...added])
    showToast(`${added.length} jeu${added.length > 1 ? 'x' : ''} Steam ajouté${added.length > 1 ? 's' : ''}`)
    for (const game of added) await findCover(game, added.length === 1)
  }

  // --- Navigation (clavier + manette) ---
  const onAction = (action: NavAction): void => {
    // 1. Une modale est ouverte : la navigation se fait dedans
    if (modal) {
      if (action === 'back') setModal(null)
      else handleModalNav(modalRef.current, action)
      return
    }

    // 2. Sinon, on navigue dans l'étagère
    const columns = countColumns(shelfRef.current)
    const last = games.length - 1
    switch (action) {
      case 'left':
        setSelected((i) => Math.max(0, i - 1))
        break
      case 'right':
        setSelected((i) => Math.min(last, i + 1))
        break
      case 'up':
        setSelected((i) => (i - columns >= 0 ? i - columns : i))
        break
      case 'down':
        setSelected((i) => (i + columns <= last ? i + columns : i))
        break
      case 'confirm':
        launch(selectedGame)
        break
      case 'edit':
        if (selectedGame) setModal({ kind: 'edit', gameId: selectedGame.id })
        break
      case 'cover':
        if (selectedGame) setModal({ kind: 'cover', gameId: selectedGame.id })
        break
      case 'settings':
        setModal({ kind: 'settings' })
        break
      case 'add':
        pickAndAdd()
        break
      case 'back':
        break
    }
  }

  const inputEnabled = !running.running
  useKeyboard(onAction, inputEnabled)
  useGamepad(onAction, inputEnabled, { speed: scroll.gamepadSpeed, acceleration: scroll.gamepadAcceleration })

  // F11 = plein écran du hub (fonctionne même quand une modale est ouverte)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F11') {
        e.preventDefault()
        window.api.toggleFullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Petit "clic" à chaque jaquette passée (molette, glisser, clavier, manette, clic)
  const previousSelected = useRef(selected)
  useEffect(() => {
    const passed = Math.abs(selected - previousSelected.current)
    previousSelected.current = selected
    if (passed === 0 || !scroll.scrollSound) return
    const volume = scroll.scrollSoundVolume / 10
    // Plusieurs jaquettes d'un coup : un clic pour chacune, en rafale (4 au maximum)
    const timers: number[] = []
    for (let i = 0; i < Math.min(passed, 4); i++) {
      timers.push(window.setTimeout(() => playTick(volume), i * 35))
    }
    return () => timers.forEach((t) => clearTimeout(t))
  }, [selected, scroll.scrollSound, scroll.scrollSoundVolume])

  // Si la liste rétrécit (suppression), on garde une sélection valide
  useEffect(() => {
    if (selected > games.length - 1) setSelected(Math.max(0, games.length - 1))
  }, [games.length, selected])

  // --- Glisser-déposer ---
  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    const paths = Array.from(event.dataTransfer.files).map((file) => window.api.getPathForFile(file))
    if (paths.length > 0) addPaths(paths)
  }

  const modalGame = modal && 'gameId' in modal ? games.find((g) => g.id === modal.gameId) : undefined

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <UpdateBanner />

      <header className="topbar">
        <h1 className="logo">
          GAMER<span>ROOM</span>
        </h1>
        <span className="count">{games.length} jeu{games.length > 1 ? 'x' : ''}</span>
        <span className="spacer" />
        <button className="btn" onClick={pickAndAdd}>
          + Ajouter
        </button>
        <button className="btn" onClick={() => setModal({ kind: 'steam' })} title="Ajouter des jeux Steam installés">
          + Jeux Steam
        </button>
        <button className="btn" onClick={() => setModal({ kind: 'settings' })}>
          Paramètres
        </button>
        <button className="btn btn-ghost" onClick={() => window.api.toggleFullscreen()} title="Plein écran (F11)">
          ⛶
        </button>
      </header>

      <main className="shelf-scroll">
        <Shelf
          ref={shelfRef}
          games={games}
          selectedIndex={selected}
          onSelect={setSelected}
          scroll={scroll}
        />
      </main>

      {selectedGame && (
        <footer className="details">
          <div>
            <div className="details-title">{selectedGame.name}</div>
            <div className="hint">{formatLastPlayed(selectedGame.lastPlayedAt)}</div>
          </div>
          <div className="details-actions">
            {/* Gros bouton « Jouer » (le seul moyen de lancer à la souris : plus de double-clic) */}
            <button className="play-btn" onClick={() => launch(selectedGame)} disabled={running.running}>
              <span className="play-btn-icon" aria-hidden="true">
                ▶
              </span>
              Jouer
            </button>
            <button className="btn" onClick={() => setModal({ kind: 'edit', gameId: selectedGame.id })}>
              Modifier
            </button>
            <button className="btn" onClick={() => setModal({ kind: 'cover', gameId: selectedGame.id })}>
              Jaquette
            </button>
          </div>
          <div className="details-help">
            <kbd>Entrée</kbd>/<kbd>A</kbd> jouer · <kbd>E</kbd>/<kbd>Y</kbd> modifier · <kbd>C</kbd>/<kbd>X</kbd>{' '}
            jaquette · <kbd>P</kbd>/<kbd>Start</kbd> paramètres · <kbd>F11</kbd> plein écran
          </div>
        </footer>
      )}

      {/* Écran de chargement : entre le clic sur Jouer et l'ouverture du jeu */}
      {running.running && running.phase !== 'playing' && (
        <LoadingScreen
          game={games.find((g) => g.id === running.gameId) ?? running.game}
          phase={running.phase}
          onCancel={() => window.api.killGame()}
        />
      )}

      {running.running && running.phase === 'playing' && (
        <div className="running-overlay">
          <p>Jeu en cours…</p>
          <button className="btn btn-danger" onClick={() => window.api.killGame()}>
            Forcer la fermeture
          </button>
        </div>
      )}

      {dragging && <div className="drop-overlay">Dépose ton .exe ou raccourci ici</div>}

      {toast && <div className={`toast${toast.error ? ' toast-error' : ''}`}>{toast.text}</div>}

      {/* --- Fenêtres modales --- */}
      {modal?.kind === 'edit' && modalGame && (
        <GameEditor
          ref={modalRef}
          game={modalGame}
          onClose={() => setModal(null)}
          onSaved={(game) => {
            replaceGame(game)
            setModal(null)
          }}
          onRemoved={(id) => {
            setGames((list) => list.filter((g) => g.id !== id))
            setModal(null)
          }}
          onChangeCover={() => setModal({ kind: 'cover', gameId: modalGame.id })}
        />
      )}
      {modal?.kind === 'cover' && modalGame && (
        <CoverPicker
          ref={modalRef}
          game={modalGame}
          initialResults={modal.results}
          onClose={() => setModal(null)}
          onApplied={(game) => {
            replaceGame(game)
            setModal(null)
          }}
        />
      )}
      {modal?.kind === 'settings' && <SettingsPanel ref={modalRef} onClose={() => setModal(null)} onSaved={setScroll} />}
      {modal?.kind === 'steam' && <SteamImport ref={modalRef} onClose={() => setModal(null)} onAdded={onSteamAdded} />}
    </div>
  )
}
