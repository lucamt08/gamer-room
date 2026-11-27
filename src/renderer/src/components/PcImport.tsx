// Fenêtre "Jeux de ce PC" : TOUS les jeux trouvés sur le PC, pas encore dans Gamer Room, rangés par launcher.
// Un seul bouton pour tout ajouter d'un coup, quel que soit le launcher :
//  - Steam : toute la bibliothèque, installée ou non (voir steamAppInfo.ts) ;
//  - Epic Games, Battle.net, GOG, Riot Games : lus dans leurs launchers (sûrs, cochés) ;
//  - « Autres jeux détectés » : la détection générale des .exe (voir pcGameDetect.ts). Les plus sûrs sont
//    cochés, les autres sont « à vérifier » (décochés), avec la raison de la détection.
// On peut ajouter un dossier où chercher (ex. E:\MesJeux) : la recherche est relancée.
// Les jeux déjà présents sont mis à jour tout seuls (installé ou non, taille) : voir steamInstalls.ts.
import { forwardRef, useEffect, useState } from 'react'
import type { DetectedGame, Game, GameSource, SteamGameEntry } from '@shared/types'
import { formatPlaytime, formatSize } from '@shared/playtime'
import Modal from './Modal'
import { cleanError } from '../utils'

interface Props {
  onClose: () => void
  /** Appelé avec les jeux ajoutés (l'appli cherche ensuite leurs jaquettes). */
  onAdded: (games: Game[]) => void
}

type Result = { games: DetectedGame[]; alreadyAdded: number }

/**
 * Une ligne de la liste, quel que soit le launcher. `key` est unique : "steam:<numéro Steam>"
 * pour Steam, la clé de pcGames.ts pour les autres.
 */
interface Row {
  key: string
  name: string
  details: string
  installed: boolean
  /** Coché d'office ? (non pour les jeux « à vérifier ») */
  sure: boolean
  title?: string
}

/** Titre de chaque section, dans l'ordre d'affichage. */
const SECTIONS: { source: 'steam' | GameSource; title: string }[] = [
  { source: 'steam', title: 'Steam' },
  { source: 'epic', title: 'Epic Games' },
  { source: 'battlenet', title: 'Battle.net' },
  { source: 'gog', title: 'GOG' },
  { source: 'riot', title: 'Riot Games' },
  { source: 'pc', title: 'Autres jeux détectés' }
]

const STEAM_PREFIX = 'steam:'

/** Jeu Steam → ligne. Petit texte : taille et temps de jeu, ex. "48,2 Go · 98 h 32 de jeu". */
function steamRow(game: SteamGameEntry): Row {
  const size = formatSize(game.sizeBytes)
  const playtime = formatPlaytime(game.playtimeMinutes * 60)
  return {
    key: STEAM_PREFIX + game.appId,
    name: game.name,
    details: [size && (game.installed ? size : `≈ ${size}`), playtime && `${playtime} de jeu`, !game.installed && 'non installé']
      .filter(Boolean)
      .join(' · '),
    installed: game.installed,
    sure: true
  }
}

/** Jeu d'un autre launcher → ligne. Ex. "48,2 Go", "non installé" ou "moteur Unity · reconnu comme jeu par Windows". */
function pcRow(game: DetectedGame): Row {
  let details: string
  if (game.installed === false) details = 'non installé'
  else if (game.source !== 'pc') details = formatSize(game.sizeBytes)
  else details = (game.confidence === 'medium' ? 'à vérifier · ' : '') + game.reasons.join(' · ')
  return {
    key: game.key,
    name: game.name,
    details,
    installed: game.installed !== false,
    sure: game.confidence === 'high',
    title: game.exePath
  }
}

const PcImport = forwardRef<HTMLDivElement, Props>(function PcImport({ onClose, onAdded }, ref) {
  // null = encore en cours de lecture
  const [steam, setSteam] = useState<SteamGameEntry[] | null>(null)
  const [pc, setPc] = useState<Result | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Coche les jeux sûrs d'une liste qui vient d'arriver (sans toucher aux autres launchers). */
  const checkSure = (rows: Row[], replacePrefix: (key: string) => boolean): void =>
    setChecked((current) => {
      const next = new Set([...current].filter((key) => !replacePrefix(key)))
      for (const row of rows) if (row.sure) next.add(row.key)
      return next
    })

  const showPc = (found: Result): void => {
    setPc(found)
    checkSure(found.games.map(pcRow), (key) => !key.startsWith(STEAM_PREFIX))
  }

  // Au chargement : Steam et les autres launchers sont lus en même temps.
  // Si l'un échoue (ex. Steam absent), l'autre s'affiche quand même.
  useEffect(() => {
    window.api.steamListGames().then(
      (list) => {
        const fresh = list.filter((g) => !g.alreadyAdded)
        setSteam(list)
        checkSure(fresh.map(steamRow), (key) => key.startsWith(STEAM_PREFIX))
      },
      () => setSteam([])
    )
    window.api.pcListGames().then(showPc, (e) => {
      setPc({ games: [], alreadyAdded: 0 })
      setError(cleanError(e))
    })
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
      showPc(await window.api.pcAddFolder())
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  // Ajout : les jeux Steam d'un côté, les autres de l'autre, puis tout est renvoyé d'un coup
  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      const keys = [...checked]
      const steamIds = keys.filter((k) => k.startsWith(STEAM_PREFIX)).map((k) => Number(k.slice(STEAM_PREFIX.length)))
      const pcKeys = keys.filter((k) => !k.startsWith(STEAM_PREFIX))
      const added: Game[] = []
      if (steamIds.length > 0) added.push(...(await window.api.steamAddGames(steamIds)))
      if (pcKeys.length > 0) added.push(...(await window.api.pcAddGames(pcKeys)))
      onAdded(added)
    } catch (e) {
      setError(cleanError(e))
      setBusy(false)
    }
  }

  const loading = steam === null || pc === null
  const steamFresh = (steam ?? []).filter((g) => !g.alreadyAdded)
  const alreadyAdded = (steam?.length ?? 0) - steamFresh.length + (pc?.alreadyAdded ?? 0)
  const pcGames = pc?.games ?? []
  const total = steamFresh.length + pcGames.length
  const allKeys = [...steamFresh.map(steamRow), ...pcGames.map(pcRow)].map((r) => r.key)

  /** Les lignes d'une section : les jeux installés d'abord, puis ceux pas installés. */
  const rowsOf = (source: 'steam' | GameSource): Row[] =>
    (source === 'steam' ? steamFresh.map(steamRow) : pcGames.filter((g) => g.source === source).map(pcRow)).sort(
      (a, b) => Number(!a.installed) - Number(!b.installed)
    )

  return (
    <Modal title="Jeux de ce PC" onClose={onClose} ref={ref}>
      {loading && !error && <p className="hint">Recherche des jeux sur ton PC (Steam, Epic, Battle.net…)…</p>}

      {!loading && (
        <>
          <div className="steam-tools">
            <span className="hint">
              {total === 0
                ? 'Tout est à jour : aucun nouveau jeu trouvé.'
                : `${total} nouveau${total > 1 ? 'x' : ''} jeu${total > 1 ? 'x' : ''}`}
              {alreadyAdded > 0 && ` · ${alreadyAdded} déjà dans Gamer Room`}
            </span>
            <span className="spacer" />
            {total > 0 && (
              <>
                <button className="btn btn-ghost" onClick={() => setChecked(new Set(allKeys))}>
                  Tout cocher
                </button>
                <button className="btn btn-ghost" onClick={() => setChecked(new Set())}>
                  Tout décocher
                </button>
              </>
            )}
            <button className="btn btn-ghost" onClick={addFolder} disabled={busy} title="Chercher aussi dans un dossier où tu ranges tes jeux">
              + Dossier de jeux…
            </button>
          </div>

          {SECTIONS.map(({ source, title }) => {
            const rows = rowsOf(source)
            if (rows.length === 0) return null
            return (
              <div key={source}>
                <h3 className="form-section">
                  {title} ({rows.length})
                </h3>
                <ul className="steam-list">
                  {rows.map((row) => (
                    <li key={row.key}>
                      <label className="checkbox" title={row.title}>
                        <input type="checkbox" checked={checked.has(row.key)} onChange={() => toggle(row.key)} />
                        <span className="steam-name">{row.name}</span>
                        <span className="hint">{row.details}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          {total > 0 && [...steamFresh, ...pcGames].some((g) => g.installed === false) && (
            <p className="hint">
              Les jeux non installés apparaissent grisés : le bouton « Installer » ouvre l'installation dans leur
              launcher.
            </p>
          )}
          {pcGames.some((g) => g.source === 'pc') && (
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
          {total === 0 ? 'Fermer' : 'Annuler'}
        </button>
        {total > 0 && (
          <button className="btn btn-primary" onClick={add} disabled={busy || checked.size === 0}>
            {busy ? 'Patiente…' : `Ajouter (${checked.size})`}
          </button>
        )}
      </div>
    </Modal>
  )
})

export default PcImport
