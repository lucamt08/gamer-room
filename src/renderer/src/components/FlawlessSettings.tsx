// Section « Flawless Widescreen » des paramètres (onglet Général) :
//  - où il a été trouvé (ou bouton pour indiquer son dossier) ;
//  - l'autorisation administrateur, donnée une seule fois (sinon elle est demandée au premier lancement).
import { useEffect, useState } from 'react'
import type { FwsStatus } from '@shared/types'
import { cleanError } from '../utils'

export default function FlawlessSettings() {
  const [status, setStatus] = useState<FwsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.fwsStatus().then(setStatus)
  }, [])

  /** Lance une action (choisir le dossier, autoriser) et affiche le nouvel état. */
  const run = async (action: () => Promise<FwsStatus>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await action())
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null

  return (
    <>
      <h3 className="form-section">Flawless Widescreen</h3>
      {status.folder ? (
        <p className="hint">
          Trouvé dans <strong>{status.folder}</strong> — {status.moduleCount} correctif
          {status.moduleCount > 1 ? 's' : ''} installé{status.moduleCount > 1 ? 's' : ''}. Au lancement d'un jeu qui a
          un correctif, Gamer Room ouvre Flawless Widescreen avec « Fix Enabled » déjà coché (réglable jeu par jeu
          dans « Modifier »).
        </p>
      ) : (
        <p className="hint">Pas trouvé sur ce PC. S'il est installé, indique son dossier.</p>
      )}

      {status.folder && (
        <p className="hint">
          {status.authorized
            ? '✔ Autorisation administrateur donnée : Flawless Widescreen se lance sans fenêtre de confirmation.'
            : 'Flawless Widescreen a besoin des droits administrateur. Autorise-le une seule fois (sinon ce sera demandé au premier lancement).'}
        </p>
      )}

      <div className="form-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => run(window.api.fwsPickFolder)}>
          {status.folder ? 'Changer de dossier…' : 'Indiquer son dossier…'}
        </button>
        {status.folder && !status.authorized && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(window.api.fwsAuthorize)}>
            Autoriser (une seule fois)
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </>
  )
}
