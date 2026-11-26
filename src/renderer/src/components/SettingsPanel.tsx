// Écran "Paramètres", en trois onglets :
//  - Général         : clé SteamGridDB, raccourci de fermeture, plein écran, son du défilement, temps de jeu,
//                      Flawless Widescreen ;
//  - Clavier / Souris : vitesse et accélération de la molette, glisser à la souris ;
//  - Manette         : vitesse et accélération quand on maintient une direction.
// Un seul bouton "Enregistrer" pour tous les onglets.
import { forwardRef, useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import Modal from './Modal'
import SettingSlider from './SettingSlider'
import FlawlessSettings from './FlawlessSettings'
import { WHEEL_LEVELS } from '../input/useWheelScroll'
import { playTick } from '../sound'

interface Props {
  onClose: () => void
  onSaved: (settings: Settings) => void
}

type Tab = 'general' | 'mouse' | 'gamepad'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'Général' },
  { id: 'mouse', label: 'Clavier / Souris' },
  { id: 'gamepad', label: 'Manette' }
]

const SettingsPanel = forwardRef<HTMLDivElement, Props>(function SettingsPanel({ onClose, onSaved }, ref) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [version, setVersion] = useState('')
  const [tab, setTab] = useState<Tab>('general')
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.getVersion().then(setVersion)
  }, [])

  if (!settings) return null

  const update = (patch: Partial<Settings>): void => setSettings({ ...settings, ...patch })

  const save = async (): Promise<void> => {
    try {
      const saved = await window.api.saveSettings(settings)
      setMessage({ text: 'Paramètres enregistrés ✔' })
      onSaved(saved)
    } catch (e) {
      setMessage({ text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), error: true })
    }
  }

  return (
    <Modal title="Paramètres" onClose={onClose} ref={ref}>
      {/* Les onglets */}
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {tab === 'general' && (
          <>
            <label>
              Clé API SteamGridDB
              <input
                type="password"
                value={settings.steamGridDbApiKey}
                onChange={(e) => update({ steamGridDbApiKey: e.target.value })}
                placeholder="Colle ta clé ici"
                autoComplete="off"
              />
              <span className="hint">
                Gratuite : crée un compte sur{' '}
                <a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noreferrer">
                  steamgriddb.com → Préférences → API
                </a>
                . Elle est stockée uniquement sur ce PC.
              </span>
            </label>

            <label>
              Raccourci pour forcer la fermeture du jeu
              <input value={settings.killShortcut} onChange={(e) => update({ killShortcut: e.target.value })} />
              <span className="hint">Format Electron, ex. Ctrl+Alt+F4, Ctrl+Shift+Q</span>
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.startFullscreen}
                onChange={(e) => update({ startFullscreen: e.target.checked })}
              />
              Démarrer le hub en plein écran (F11 pour basculer à tout moment)
            </label>

            <h3 className="form-section">Son</h3>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.scrollSound}
                onChange={(e) => update({ scrollSound: e.target.checked })}
              />
              Petit « clic » à chaque jaquette quand je fais défiler
            </label>
            <SettingSlider
              label="Volume du clic"
              min={1}
              max={10}
              value={settings.scrollSoundVolume}
              onChange={(scrollSoundVolume) => {
                update({ scrollSoundVolume })
                playTick(scrollSoundVolume / 10) // on fait écouter le nouveau volume
              }}
              valueText={`${settings.scrollSoundVolume} / 10`}
              minLabel="Doux"
              maxLabel="Fort"
              disabled={!settings.scrollSound}
            />

            <h3 className="form-section">Temps de jeu</h3>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.trackOutsideApp}
                onChange={(e) => update({ trackOutsideApp: e.target.checked })}
              />
              Compter le temps de jeu même quand le jeu n'est pas lancé depuis Gamer Room
            </label>
            <p className="hint">
              Gamer Room démarre alors avec Windows et reste près de l'horloge : la croix cache le hub sans le
              quitter. Pour la fermer vraiment : clic droit sur son icône → Quitter. Les jeux Steam sont toujours
              à jour (leur temps vient de Steam).
            </p>

            <FlawlessSettings />
          </>
        )}

        {tab === 'mouse' && (
          <>
            <h3 className="form-section">Molette</h3>
            <SettingSlider
              label="Vitesse de la molette"
              min={1}
              max={5}
              value={settings.wheelLevel}
              onChange={(wheelLevel) => update({ wheelLevel })}
              valueText={WHEEL_LEVELS[settings.wheelLevel - 1]?.name ?? ''}
              hint="Chaque cran compte toujours pareil. Moyen = la vitesse d'origine."
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.wheelAcceleration}
                onChange={(e) => update({ wheelAcceleration: e.target.checked })}
              />
              Accélérer quand je tourne la molette vite (pratique avec une molette libre)
            </label>

            <h3 className="form-section">Glisser à la souris</h3>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.dragScroll}
                onChange={(e) => update({ dragScroll: e.target.checked })}
              />
              Faire défiler les jaquettes en cliquant-glissant vers la gauche ou la droite
            </label>
            <SettingSlider
              label="Sensibilité du glisser"
              min={1}
              max={5}
              value={settings.dragSensitivity}
              onChange={(dragSensitivity) => update({ dragSensitivity })}
              valueText={`${settings.dragSensitivity} / 5`}
              disabled={!settings.dragScroll}
            />
          </>
        )}

        {tab === 'gamepad' && (
          <>
            <SettingSlider
              label="Vitesse de défilement"
              min={1}
              max={9}
              value={settings.gamepadSpeed}
              onChange={(gamepadSpeed) => update({ gamepadSpeed })}
              valueText={settings.gamepadSpeed === 5 ? 'Moyen' : `${settings.gamepadSpeed} / 9`}
              hint="Quand on maintient la croix ou le stick. 5 = moyen (la vitesse d'origine)."
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.gamepadAcceleration}
                onChange={(e) => update({ gamepadAcceleration: e.target.checked })}
              />
              Accélérer quand je maintiens la direction longtemps
            </label>
          </>
        )}

        {message && <p className={message.error ? 'error' : 'success'}>{message.text}</p>}

        <div className="form-actions">
          <span className="hint">Version {version}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => window.api.checkUpdate()}>
            Vérifier les mises à jour
          </button>
          <button type="submit" className="btn btn-primary">
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  )
})

export default SettingsPanel
