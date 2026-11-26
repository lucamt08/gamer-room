// Une jauge (curseur à faire glisser) pour un réglage chiffré des Paramètres,
// avec son titre, la valeur actuelle en clair et "lent / rapide" aux deux bouts.
// Au clavier : flèches gauche/droite. À la manette : gauche/droite (voir input/focusNav.ts).

interface Props {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** Texte affiché à droite du titre, ex. "3 jeux par cran". */
  valueText: string
  /** Petite explication sous la jauge. */
  hint?: string
  disabled?: boolean
  /** Textes aux deux bouts de la jauge (par défaut "Lent" et "Rapide"). */
  minLabel?: string
  maxLabel?: string
}

export default function SettingSlider({
  label,
  value,
  min,
  max,
  onChange,
  valueText,
  hint,
  disabled,
  minLabel = 'Lent',
  maxLabel = 'Rapide'
}: Props) {
  return (
    <label className={`slider${disabled ? ' slider-disabled' : ''}`}>
      <span className="slider-header">
        {label}
        <span className="slider-value">{valueText}</span>
      </span>
      <span className="slider-row">
        <span className="hint">{minLabel}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="hint">{maxLabel}</span>
      </span>
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}
