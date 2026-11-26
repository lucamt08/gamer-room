// Option « Flawless Widescreen » de l'écran "Modifier" : quel correctif activer au lancement du jeu.
// N'affiche rien si Flawless Widescreen n'est pas installé sur ce PC.
//  - « Automatique » : le correctif reconnu pour ce jeu (sauf s'il prévient d'un anti-cheat) ;
//  - « Désactivé »   : jamais de correctif ;
//  - un correctif précis, choisi à la main.
import { useEffect, useState } from 'react'
import type { FwsGameInfo } from '@shared/types'

interface Props {
  gameId: string
  /** 'auto', 'off' ou la clé d'un correctif. */
  value: string
  onChange: (value: string) => void
}

export default function FlawlessOption({ gameId, value, onChange }: Props) {
  const [info, setInfo] = useState<FwsGameInfo | null>(null)

  useEffect(() => {
    window.api.fwsGameInfo(gameId).then(setInfo, () => setInfo(null))
  }, [gameId])

  if (!info?.installed) return null

  const detected = info.modules.find((m) => m.key === info.detectedKey) ?? null
  const chosen = info.modules.find((m) => m.key === value) ?? null

  // Texte de l'option "Automatique" : ce qui se passera vraiment
  let autoLabel = 'Automatique (aucun correctif pour ce jeu)'
  if (detected) autoLabel = `Automatique (${detected.name}${detected.anticheat ? ' — non activé : anti-cheat' : ''})`

  return (
    <label>
      Correctif Flawless Widescreen
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="auto">{autoLabel}</option>
        <option value="off">Désactivé</option>
        {info.modules.map((m) => (
          <option key={m.key} value={m.key}>
            {m.name}
            {m.anticheat ? ' ⚠️ anti-cheat' : ''}
          </option>
        ))}
      </select>
      {value === 'auto' && detected?.anticheat && (
        <span className="hint">
          Ce correctif prévient d'un anti-cheat : il n'est pas activé automatiquement. Choisis-le dans la liste
          seulement si tu as désactivé l'anti-cheat du jeu (risque de bannissement en ligne).
        </span>
      )}
      {chosen?.anticheat && (
        <span className="error">
          ⚠️ Ce jeu a un anti-cheat : désactive-le avant de jouer avec ce correctif, sinon tu risques d'être banni
          en ligne.
        </span>
      )}
      {value !== 'off' && (value !== 'auto' || (detected && !detected.anticheat)) && (
        <span className="hint">
          Au lancement, Gamer Room ouvre Flawless Widescreen avec « Fix Enabled » déjà coché. Tes autres réglages
          se font dans Flawless Widescreen, qui les retient.
        </span>
      )}
    </label>
  )
}
