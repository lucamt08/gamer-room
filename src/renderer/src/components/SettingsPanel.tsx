// Écran "Paramètres" : clé SteamGridDB, raccourci de fermeture, plein écran, version.
import { forwardRef, useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import Modal from './Modal'

interface Props {
  onClose: () => void
  onSaved: (settings: Settings) => void
}

const SettingsPanel = forwardRef<HTMLDivElement, Props>(function SettingsPanel({ onClose, onSaved }, ref) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [version, setVersion] = useState('')
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
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
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
