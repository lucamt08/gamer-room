// Panneau de détails d'un jeu, ouvert par un clic sur sa boîte (ou la touche I / le bouton RB de la manette).
//
// Le jeu glisse sur la GAUCHE de l'écran (jaquette + boutons Jouer, Modifier, Jaquette),
// et sur la DROITE on voit ses infos :
//  - pour tous les jeux : d'où il vient (Steam, Epic…), temps de jeu, dernière partie, taille ;
//  - la FICHE du jeu, au même format pour tous (voir main/gameInfo.ts) : description, développeur, genres,
//    modes de jeu, note Metacritic… venant de la page Steam du jeu, ou de Wikipédia s'il n'est pas sur Steam ;
//  - pour les jeux Steam : les SUCCÈS (trophées) débloqués ou non, avec leur rareté.
// Échap / bouton B (ou « ← Retour ») referme le panneau. Gauche / droite passe au jeu précédent / suivant.
import { forwardRef, useEffect, useState } from 'react'
import type { Game, GameInfo, GameSheet, SteamAchievement } from '@shared/types'
import { gameOrigin, originLabel } from '@shared/duplicates'

interface Props {
  game: Game
  /** Les autres exemplaires du même jeu (ex. aussi sur Epic Games), voir shared/duplicates.ts. */
  otherCopies: Game[]
  /** Ligne « 12 h de jeu · Joué hier · 48 Go », préparée par App.tsx. */
  stats: string
  running: boolean
  onClose: () => void
  onPlay: () => void
  onEdit: () => void
  onCover: () => void
}

/** "12 mars 2025" */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** "76,7 %" */
function formatPercent(value: number): string {
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

/** Les succès débloqués d'abord (les plus récents en haut), puis les autres (les plus faciles en haut). */
function sortAchievements(list: SteamAchievement[]): SteamAchievement[] {
  return [...list].sort((a, b) => {
    if (a.unlockedAt && b.unlockedAt) return b.unlockedAt.localeCompare(a.unlockedAt)
    if (a.unlockedAt || b.unlockedAt) return a.unlockedAt ? -1 : 1
    return (b.globalPercent ?? -1) - (a.globalPercent ?? -1)
  })
}

/**
 * Les infos de la fiche, toujours dans le même ordre (que la fiche vienne de Steam ou de Wikipédia).
 * Une info absente n'est pas affichée.
 */
function sheetFacts(sheet: GameSheet | null): [string, string][] {
  if (!sheet) return []
  const facts: [string, string][] = []
  if (sheet.developers.length) facts.push(['Développeur', sheet.developers.join(', ')])
  if (sheet.publishers.length) facts.push(['Éditeur', sheet.publishers.join(', ')])
  if (sheet.releaseDate) facts.push(['Sortie', sheet.releaseDate])
  if (sheet.genres.length) facts.push(['Genres', sheet.genres.join(', ')])
  if (sheet.modes.length) facts.push(['Modes de jeu', sheet.modes.join(', ')])
  if (sheet.series) facts.push(['Série', sheet.series])
  if (sheet.platforms.length) facts.push(['Plateformes', sheet.platforms.join(', ')])
  if (sheet.controllerSupport) facts.push(['Manette', sheet.controllerSupport === 'full' ? 'Compatible' : 'Compatibilité partielle'])
  if (sheet.metacritic) facts.push(['Metacritic', `${sheet.metacritic} / 100`])
  if (sheet.recommendations) facts.push(['Évaluations Steam', sheet.recommendations.toLocaleString('fr-FR')])
  return facts
}

/** Une ligne de succès. */
function AchievementRow({ achievement }: { achievement: SteamAchievement }) {
  const unlocked = achievement.unlockedAt !== null
  const secret = achievement.hidden && !unlocked
  const rare = achievement.globalPercent !== null && achievement.globalPercent < 10
  return (
    <li className={`gd-ach${unlocked ? ' unlocked' : ''}`}>
      {achievement.iconUrl ? <img className="gd-ach-icon" src={achievement.iconUrl} alt="" loading="lazy" /> : <span className="gd-ach-icon" />}
      <div className="gd-ach-text">
        <div className="gd-ach-name">
          {secret ? 'Succès caché' : achievement.name}
          {rare && <span className="gd-ach-rare">Rare</span>}
        </div>
        <div className="gd-ach-desc">{secret ? 'Continue de jouer pour le découvrir.' : achievement.description}</div>
      </div>
      <div className="gd-ach-side">
        {unlocked && (
          <div>{new Date(achievement.unlockedAt!).getTime() > 0 ? `Débloqué le ${formatDate(achievement.unlockedAt!)}` : 'Débloqué'}</div>
        )}
        {achievement.globalPercent !== null && <div className="hint">{formatPercent(achievement.globalPercent)} des joueurs</div>}
      </div>
    </li>
  )
}

const GameDetails = forwardRef<HTMLDivElement, Props>(function GameDetails(
  { game, otherCopies, stats, running, onClose, onPlay, onEdit, onCover },
  ref
) {
  const [info, setInfo] = useState<GameInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const isSteam = gameOrigin(game) === 'steam'
  const coverUrl = game.coverFile ? `cover://img/${encodeURIComponent(game.coverFile)}` : null

  // Fiche du jeu + succès (relus à chaque changement de jeu, ou quand il est renommé)
  useEffect(() => {
    setInfo(null)
    let cancelled = false
    setLoading(true)
    window.api
      .gameInfo(game.id)
      .then((result) => !cancelled && setInfo(result))
      .catch(() => !cancelled && setInfo({ sheet: null, achievements: null }))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [game.id, game.name])

  const sheet = info?.sheet ?? null
  const achievements = info?.achievements ?? null
  const unlockedCount = achievements?.filter((a) => a.unlockedAt).length ?? 0
  const facts = sheetFacts(sheet)
  // Infos du PC, quand la fiche ne les donne pas : éditeur lu dans le .exe, dossier d'un jeu local
  if (game.publisher && !facts.some(([label]) => label === 'Éditeur')) facts.push(['Éditeur', game.publisher])
  if (gameOrigin(game) === 'pc' && game.installed !== false) {
    const exe = game.realExePath ?? game.exePath
    facts.push(['Dossier', game.gameFolder ?? exe.slice(0, exe.lastIndexOf('\\'))])
  }
  const store = sheet // l'image de fond et les captures n'existent que pour les fiches Steam

  return (
    <div className="gd-overlay">
      {/* Fond : l'image de la page Steam, ou la jaquette floutée */}
      {(store?.background || coverUrl) && (
        <div
          className={`gd-bg${store?.background ? '' : ' blurred'}`}
          style={{ backgroundImage: `url("${store?.background ?? coverUrl}")` }}
        />
      )}

      <button className="btn btn-ghost gd-back" onClick={onClose}>
        ← Retour
      </button>

      {/* À gauche : le jeu */}
      <div className="gd-left" key={game.id}>
        <div className="gd-cover">
          {coverUrl ? <img src={coverUrl} alt="" /> : <span>{game.name.charAt(0)}</span>}
        </div>
        <button className="play-btn" onClick={onPlay} disabled={running}>
          <span className="play-btn-icon" aria-hidden="true">
            {game.installed === false ? '⬇' : '▶'}
          </span>
          {game.installed === false ? 'Installer' : 'Jouer'}
        </button>
        <div className="gd-left-actions">
          <button className="btn" onClick={onEdit}>
            Modifier
          </button>
          <button className="btn" onClick={onCover}>
            Jaquette
          </button>
        </div>
      </div>

      {/* À droite : les infos (on peut les faire défiler) */}
      <div className="gd-right" ref={ref} key={`info-${game.id}`}>
        <h2 className="gd-title">{game.name}</h2>
        <div className="details-origin">
          <span className={`origin-tag origin-${gameOrigin(game)}`}>{originLabel(game)}</span>
          {otherCopies.length > 0 && (
            <span className="hint">
              Aussi : {otherCopies.map((c) => originLabel(c) + (c.installed === false ? ' (non installé)' : '')).join(', ')}
            </span>
          )}
        </div>
        <p className="gd-stats">{stats}</p>

        {loading && <p className="hint">Chargement de la fiche du jeu…</p>}
        {!loading && !sheet && (
          <p className="hint">
            Pas de fiche trouvée pour ce jeu (jeu peu connu, nom différent, ou pas d'Internet). Astuce : vérifie que
            son nom est exact dans « Modifier ».
          </p>
        )}

        {sheet?.shortDescription && <p className="gd-desc">{sheet.shortDescription}</p>}
        {sheet && (
          <p className="gd-source">
            {sheet.source === 'steam' ? 'Source : page Steam du jeu' : 'Source : Wikipédia et Wikidata (licence CC BY-SA)'}
          </p>
        )}

        {facts.length > 0 && (
          <dl className="gd-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {store && store.screenshots.length > 0 && (
          <div className="gd-shots">
            {store.screenshots.map((url) => (
              <img key={url} src={url} alt="" loading="lazy" />
            ))}
          </div>
        )}

        {isSteam && !loading && (
          <section className="gd-section">
            <h3>
              🏆 Succès
              {achievements && (
                <span className="gd-ach-count">
                  {unlockedCount} / {achievements.length}
                </span>
              )}
            </h3>
            {achievements ? (
              <>
                <div className="gd-progress">
                  <div style={{ width: `${(unlockedCount / achievements.length) * 100}%` }} />
                </div>
                <ul className="gd-ach-list">
                  {sortAchievements(achievements).map((a) => (
                    <AchievementRow key={a.id} achievement={a} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="hint">
                Pas de succès pour ce jeu, ou Steam ne les a pas encore enregistrés sur ce PC (lance le jeu une fois
                depuis Steam).
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
})

export default GameDetails
