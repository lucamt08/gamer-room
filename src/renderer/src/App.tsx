// Composant principal : l'étagère + les fenêtres modales + la navigation.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Game, InstallProgress, RunningState, SgdbGame } from '@shared/types'
import { formatPlaytime, formatSize, playtimeFromSteam, totalPlaytimeSeconds } from '@shared/playtime'
import { DEFAULT_SCROLL_SETTINGS, type ScrollSettings } from '@shared/scroll'
import { storeName } from '@shared/launch'
import { gameOrigin, groupDuplicates, originLabel } from '@shared/duplicates'
import Shelf from './components/Shelf'
import GameEditor from './components/GameEditor'
import CoverPicker from './components/CoverPicker'
import SettingsPanel from './components/SettingsPanel'
import UpdateBanner from './components/UpdateBanner'
import LoadingScreen from './components/LoadingScreen'
import SteamImport from './components/SteamImport'
import PcImport from './components/PcImport'
import GameDetails from './components/GameDetails'
import FpsCounter from './components/FpsCounter'
import type { NavAction } from './input/actions'
import { useKeyboard } from './input/useKeyboard'
import { useGamepad } from './input/useGamepad'
import { handleModalNav } from './input/focusNav'
import { cleanError } from './utils'
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

/**
 * Ligne affichée sous le nom du jeu sélectionné : temps de jeu total, dernière partie et taille.
 * Ex. "12 h 30 de jeu · Joué hier · 48,2 Go", "Jamais joué · ⬇ Non installé · ≈ 65 Go",
 * ou "98 h 32 de jeu · Installation… 42 %" pendant un téléchargement Steam.
 */
function formatGameStats(game: Game, installPercent: number | undefined): string {
  const parts: string[] = []
  const playtime = formatPlaytime(totalPlaytimeSeconds(game))
  if (playtime) parts.push(`${playtime} de jeu`)
  // Temps de départ saisi à la main mais jamais lancé : pas de "Jamais joué" à côté
  if (game.lastPlayedAt || !playtime) parts.push(formatLastPlayed(game.lastPlayedAt))
  const size = formatSize(game.sizeBytes)
  if (game.installed === false) {
    if (installPercent !== undefined) parts.push(`Installation… ${installPercent} %`)
    else parts.push(size ? `⬇ Non installé · ≈ ${size}` : '⬇ Non installé')
  } else if (size) {
    parts.push(size)
  }
  return parts.join(' · ')
}

/** Les boutons sous le jeu sélectionné, dans l'ordre (la manette s'y déplace avec gauche / droite). */
const FOOTER_BUTTONS = ['play', 'infos', 'edit', 'cover'] as const
type FooterButton = (typeof FOOTER_BUTTONS)[number]

/** Quelle fenêtre modale est ouverte (au plus une à la fois). */
type ModalState =
  | null
  | { kind: 'edit'; gameId: string }
  | { kind: 'cover'; gameId: string; results?: SgdbGame[] }
  | { kind: 'settings' }
  | { kind: 'steam' }
  | { kind: 'pc' }

export default function App() {
  const [games, setGames] = useState<Game[]>([])
  const [selected, setSelected] = useState(0)
  const [modal, setModal] = useState<ModalState>(null)
  const [running, setRunning] = useState<RunningState>({ running: false, gameId: null })
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  // Téléchargements Steam en cours (id du jeu → pourcentage)
  const [installProgress, setInstallProgress] = useState<InstallProgress>({})
  // Réglages de défilement (molette, glisser, manette), mis à jour quand on enregistre les Paramètres
  const [scroll, setScroll] = useState<ScrollSettings>(DEFAULT_SCROLL_SETTINGS)

  // Panneau de détails ouvert (clic sur la boîte du centre, touche I, bouton RB) : voir GameDetails.tsx
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Bouton choisi au clavier / à la manette sous le jeu (index dans FOOTER_BUTTONS), ou null = on est sur l'étagère
  const [footerFocus, setFooterFocus] = useState<number | null>(null)

  const shelfRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const detailsRef = useRef<HTMLDivElement>(null)

  // --- Chargement initial + écoute de l'état "jeu en cours" ---
  useEffect(() => {
    window.api.getGames().then(setGames)
    window.api.getSettings().then(setScroll)
    // Un jeu corrigé en arrière-plan au démarrage (ex. "Longshot" → son vrai nom et sa jaquette)
    const stopGameUpdates = window.api.onGameUpdated(replaceGame)
    const stopInstallProgress = window.api.onInstallProgress(setInstallProgress)
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
      stopInstallProgress()
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

  // L'étagère : un seul exemplaire par jeu (ex. Rocket League sur Steam ET Epic → une boîte), voir shared/duplicates.ts
  const { visible: shelfGames, otherCopies } = useMemo(() => groupDuplicates(games), [games])
  const selectedGame: Game | undefined = shelfGames[selected]

  // Jeu à sélectionner dès qu'il apparaît sur l'étagère (après un ajout)
  const [selectId, setSelectId] = useState<string | null>(null)
  useEffect(() => {
    if (!selectId) return
    // Le jeu ajouté peut être caché derrière un autre exemplaire : on sélectionne alors celui affiché
    const index = shelfGames.findIndex((g) => g.id === selectId || otherCopies.get(g.id)?.some((c) => c.id === selectId))
    if (index >= 0) setSelected(index)
    setSelectId(null)
  }, [shelfGames, otherCopies, selectId])

  // --- Actions principales ---
  /** Ce jeu est-il celui en cours de partie ? (ou un autre exemplaire du même jeu, voir duplicates.ts) */
  const isPlaying = (game: Game | undefined): boolean =>
    !!game &&
    running.running &&
    running.phase === 'playing' &&
    (game.id === running.gameId || !!otherCopies.get(game.id)?.some((c) => c.id === running.gameId))

  const launch = useCallback(
    async (game: Game | undefined) => {
      if (!game) return
      // Hub ouvert en pleine partie (bouton Xbox / PS) : « Reprendre le jeu »
      if (isPlaying(game)) {
        window.api.resumeGame()
        return
      }
      if (running.running) return
      try {
        // Jeu Steam, Epic ou Riot pas installé : « Jouer » devient « Installer » (le magasin ouvre sa fenêtre d'installation)
        if (game.installed === false) {
          await window.api.installGame(game.id)
          showToast(`${storeName(game)} ouvre l'installation de ${game.name}`)
          return
        }
        await window.api.launchGame(game.id)
      } catch (e) {
        showToast(cleanError(e), true)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, otherCopies]
  )

  /** Ajoute des jeux à partir de chemins de fichiers, puis cherche leurs jaquettes. */
  const addPaths = async (paths: string[]): Promise<void> => {
    for (const path of paths) {
      try {
        const game = await window.api.addGame(path)
        setGames((list) => [...list, game])
        setSelectId(game.id) // on sélectionne le nouveau jeu
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

  /** Jeux ajoutés depuis une fenêtre d'import (Steam ou PC) : on les affiche, puis on cherche leurs jaquettes. */
  const onImported = async (added: Game[]): Promise<void> => {
    setModal(null)
    if (added.length === 0) return
    setGames((list) => [...list, ...added])
    showToast(`${added.length} jeu${added.length > 1 ? 'x' : ''} ajouté${added.length > 1 ? 's' : ''}`)
    for (const game of added) await findCover(game, added.length === 1)
  }

  /** Un bouton sous le jeu : clic à la souris, ou A / Entrée quand il est choisi à la manette / au clavier. */
  const runFooterButton = (button: FooterButton): void => {
    if (!selectedGame) return
    switch (button) {
      case 'play':
        launch(selectedGame)
        break
      case 'infos':
        setFooterFocus(null) // en refermant le panneau, on revient sur l'étagère
        setDetailsOpen(true)
        break
      case 'edit':
        setModal({ kind: 'edit', gameId: selectedGame.id })
        break
      case 'cover':
        setModal({ kind: 'cover', gameId: selectedGame.id })
        break
    }
  }

  // --- Navigation (clavier + manette) ---
  const onAction = (action: NavAction): void => {
    // 1. Une modale est ouverte : la navigation se fait dedans
    if (modal) {
      if (action === 'back') setModal(null)
      else handleModalNav(modalRef.current, action)
      return
    }

    const last = shelfGames.length - 1

    // 2. Panneau de détails ouvert : haut/bas font défiler les infos, gauche/droite changent de jeu
    if (detailsOpen) {
      switch (action) {
        case 'back':
        case 'details':
          setDetailsOpen(false)
          break
        case 'up':
        case 'down':
          detailsRef.current?.scrollBy({ top: action === 'up' ? -200 : 200, behavior: 'smooth' })
          break
        case 'left':
          setSelected((i) => Math.max(0, i - 1))
          break
        case 'right':
          setSelected((i) => Math.min(last, i + 1))
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
          break
      }
      return
    }

    // 3. Rangée de boutons sous le jeu (Jouer · Infos · Modifier · Jaquette), atteinte avec « bas »
    if (footerFocus !== null) {
      switch (action) {
        case 'left':
          setFooterFocus(Math.max(0, footerFocus - 1))
          return
        case 'right':
          setFooterFocus(Math.min(FOOTER_BUTTONS.length - 1, footerFocus + 1))
          return
        case 'up':
        case 'back':
          setFooterFocus(null) // retour à l'étagère
          return
        case 'confirm':
          runFooterButton(FOOTER_BUTTONS[footerFocus])
          return
        case 'down':
          return
      }
      // Les autres boutons (Y, X, Start, RB…) font la même chose que sur l'étagère
    }

    // 4. Sinon, on navigue dans l'étagère
    const columns = Math.max(1, shelfGames.length) // l'étagère n'a qu'une rangée
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
        // Pas de rangée en dessous (l'étagère n'en a qu'une) : on descend sur les boutons, sur « Infos »
        if (selected + columns <= last) setSelected(selected + columns)
        else if (selectedGame) setFooterFocus(FOOTER_BUTTONS.indexOf('infos'))
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
      case 'details':
        if (selectedGame) runFooterButton('infos')
        break
      case 'back':
        // Hub ouvert en pleine partie : B ramène au jeu
        if (playingNow) window.api.resumeGame()
        break
    }
  }

  // Plus de jeu sélectionné (bibliothèque vide) : on referme le panneau de détails
  useEffect(() => {
    if (!selectedGame) setDetailsOpen(false)
  }, [selectedGame])

  // Le hub est-il au premier plan ? Pendant une partie, il reste juste derrière le jeu (voir gameLauncher.ts) :
  // la manette ne doit pas le piloter en douce pendant qu'on joue
  const isActive = (): boolean => document.visibilityState === 'visible' && document.hasFocus()
  const [hubVisible, setHubVisible] = useState(isActive)
  useEffect(() => {
    const onChange = (): void => setHubVisible(isActive())
    document.addEventListener('visibilitychange', onChange)
    window.addEventListener('focus', onChange)
    window.addEventListener('blur', onChange)
    return () => {
      document.removeEventListener('visibilitychange', onChange)
      window.removeEventListener('focus', onChange)
      window.removeEventListener('blur', onChange)
    }
  }, [])

  // Hub rouvert pendant la partie (bouton Xbox / PS) : on se place sur le jeu en cours, sur « Reprendre le jeu »
  const playingNow = running.running && running.phase === 'playing'
  useEffect(() => {
    if (!playingNow || !hubVisible) return
    const index = shelfGames.findIndex(
      (g) => g.id === running.gameId || otherCopies.get(g.id)?.some((c) => c.id === running.gameId)
    )
    if (index >= 0) setSelected(index)
    setDetailsOpen(false)
    setFooterFocus(FOOTER_BUTTONS.indexOf('play'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingNow, hubVisible])

  // Pendant le chargement : pas de navigation. En pleine partie : seulement quand le hub est à l'écran.
  const inputEnabled = !running.running || (playingNow && hubVisible)
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
    if (selected > shelfGames.length - 1) setSelected(Math.max(0, shelfGames.length - 1))
  }, [shelfGames.length, selected])

  // --- Glisser-déposer ---
  // Sécurité : le cadre « Dépose ton .exe » se cache dès qu'un glisser se termine
  // (lâché ailleurs, annulé avec Échap) ou au moindre clic, pour ne jamais rester bloqué
  useEffect(() => {
    const hide = (): void => setDragging(false)
    window.addEventListener('dragend', hide)
    window.addEventListener('drop', hide)
    window.addEventListener('mousedown', hide)
    return () => {
      window.removeEventListener('dragend', hide)
      window.removeEventListener('drop', hide)
      window.removeEventListener('mousedown', hide)
    }
  }, [])

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
        // Seulement pour des fichiers venus de Windows : glisser une image ou un texte
        // de l'appli (souris qui bouge pendant un clic) ne doit pas afficher le cadre
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        // relatedTarget vide = la souris est sortie de la fenêtre
        if (e.relatedTarget === null || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <UpdateBanner />
      <FpsCounter />

      <header className="topbar">
        <h1 className="logo">
          GAMER<span>ROOM</span>
        </h1>
        <span className="count">{shelfGames.length} jeu{shelfGames.length > 1 ? 'x' : ''}</span>
        <span className="spacer" />
        <button className="btn" onClick={pickAndAdd}>
          + Ajouter
        </button>
        <button className="btn" onClick={() => setModal({ kind: 'steam' })} title="Ajouter les jeux de ta bibliothèque Steam (installés ou non) et mettre la liste à jour">
          + Jeux Steam
        </button>
        <button className="btn" onClick={() => setModal({ kind: 'pc' })} title="Ajouter les jeux Epic Games, Battle.net, GOG, Riot Games et les jeux sans launcher">
          + Jeux du PC
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
          games={shelfGames}
          selectedIndex={selected}
          onSelect={setSelected}
          onOpen={(index) => {
            setSelected(index)
            setFooterFocus(null)
            setDetailsOpen(true)
          }}
          scroll={scroll}
        />
      </main>

      {selectedGame && (
        <footer className="details">
          <div>
            <div className="details-title">{selectedGame.name}</div>
            {/* D'où vient le jeu (Steam, Epic Games… ou jeu local sans launcher), et ses autres exemplaires */}
            <div className="details-origin">
              <span className={`origin-tag origin-${gameOrigin(selectedGame)}`}>{originLabel(selectedGame)}</span>
              {otherCopies.get(selectedGame.id) && (
                <span className="hint">
                  Aussi :{' '}
                  {otherCopies
                    .get(selectedGame.id)!
                    .map((copy) => originLabel(copy) + (copy.installed === false ? ' (non installé)' : ''))
                    .join(', ')}
                </span>
              )}
            </div>
            <div
              className="hint"
              title={playtimeFromSteam(selectedGame) ? 'Temps de jeu importé de Steam' : 'Temps de jeu compté par Gamer Room'}
            >
              {formatGameStats(selectedGame, installProgress[selectedGame.id])}
            </div>
          </div>
          {/* Boutons sous le jeu. À la manette / au clavier : « bas » pour y aller, gauche / droite, A pour valider */}
          <div className="details-actions">
            {/* Gros bouton « Jouer » (le seul moyen de lancer à la souris : plus de double-clic) */}
            <button
              className={`play-btn${footerFocus === 0 ? ' pad-focus' : ''}`}
              onClick={() => runFooterButton('play')}
              disabled={running.running && !isPlaying(selectedGame)}
            >
              <span className="play-btn-icon" aria-hidden="true">
                {selectedGame.installed === false && !isPlaying(selectedGame) ? '⬇' : '▶'}
              </span>
              {isPlaying(selectedGame) ? 'Reprendre le jeu' : selectedGame.installed === false ? 'Installer' : 'Jouer'}
            </button>
            <button className={`btn${footerFocus === 1 ? ' pad-focus' : ''}`} onClick={() => runFooterButton('infos')}>
              ⓘ Infos
            </button>
            <button className={`btn${footerFocus === 2 ? ' pad-focus' : ''}`} onClick={() => runFooterButton('edit')}>
              Modifier
            </button>
            <button className={`btn${footerFocus === 3 ? ' pad-focus' : ''}`} onClick={() => runFooterButton('cover')}>
              Jaquette
            </button>
          </div>
          {/* En pleine partie : rappel du jeu en cours, et fermeture forcée à la souris */}
          {playingNow && (
            <div className="details-help">
              Jeu en cours · <kbd>A</kbd> reprendre · <kbd>B</kbd> retour au jeu ·{' '}
              <button className="btn btn-ghost btn-danger" onClick={() => window.api.killGame()}>
                Forcer la fermeture
              </button>
            </div>
          )}
          <div className="details-help">
            <kbd>Entrée</kbd>/<kbd>A</kbd> jouer · <kbd>↓</kbd> boutons (Infos…) · <kbd>I</kbd>/<kbd>RB</kbd> infos ·{' '}
            <kbd>E</kbd>/<kbd>Y</kbd> modifier · <kbd>C</kbd>/<kbd>X</kbd> jaquette · <kbd>P</kbd>/<kbd>Start</kbd>{' '}
            paramètres · <kbd>F11</kbd> plein écran
          </div>
        </footer>
      )}

      {/* Panneau de détails : le jeu à gauche, ses infos (succès, fiche Steam…) à droite */}
      {detailsOpen && selectedGame && (
        <GameDetails
          ref={detailsRef}
          game={selectedGame}
          otherCopies={otherCopies.get(selectedGame.id) ?? []}
          stats={formatGameStats(selectedGame, installProgress[selectedGame.id])}
          running={running.running}
          onClose={() => setDetailsOpen(false)}
          onPlay={() => launch(selectedGame)}
          onEdit={() => setModal({ kind: 'edit', gameId: selectedGame.id })}
          onCover={() => setModal({ kind: 'cover', gameId: selectedGame.id })}
        />
      )}

      {/* Écran de chargement : entre le clic sur Jouer et l'ouverture du jeu */}
      {running.running && running.phase !== 'playing' && (
        <LoadingScreen
          game={games.find((g) => g.id === running.gameId) ?? running.game}
          phase={running.phase}
          onCancel={() => window.api.killGame()}
        />
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
      {modal?.kind === 'steam' && <SteamImport ref={modalRef} onClose={() => setModal(null)} onAdded={onImported} />}
      {modal?.kind === 'pc' && <PcImport ref={modalRef} onClose={() => setModal(null)} onAdded={onImported} />}
    </div>
  )
}
