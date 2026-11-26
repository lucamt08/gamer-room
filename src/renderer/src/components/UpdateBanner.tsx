// Bandeau de mise à jour, affiché en haut quand une nouvelle version existe.
import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'

export default function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => window.api.onUpdateStatus(setStatus), [])

  switch (status.state) {
    case 'available':
      return (
        <div className="update-banner">
          Nouvelle version {status.version} disponible !
          <button className="btn btn-primary" onClick={() => window.api.downloadUpdate()}>
            Télécharger et installer
          </button>
          <button className="btn btn-ghost" onClick={() => setStatus({ state: 'idle' })}>
            Plus tard
          </button>
        </div>
      )
    case 'downloading':
      return <div className="update-banner">Téléchargement de la mise à jour… {status.percent} %</div>
    case 'downloaded':
      return (
        <div className="update-banner">
          Version {status.version} prête.
          <button className="btn btn-primary" onClick={() => window.api.installUpdate()}>
            Redémarrer et installer
          </button>
        </div>
      )
    case 'not-available':
      return (
        <div className="update-banner">
          Tu as déjà la dernière version 👍
          <button className="btn btn-ghost" onClick={() => setStatus({ state: 'idle' })}>
            OK
          </button>
        </div>
      )
    case 'checking':
    case 'idle':
      return null
    case 'error':
      return (
        <div className="update-banner error-banner">
          Mise à jour impossible : {status.message}
          <button className="btn btn-ghost" onClick={() => setStatus({ state: 'idle' })}>
            OK
          </button>
        </div>
      )
  }
}
