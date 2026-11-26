// Navigation "simple" à l'intérieur d'une fenêtre modale (Modifier, Paramètres…) :
// haut/gauche = élément précédent, bas/droite = élément suivant,
// confirmer = cliquer sur l'élément qui a le focus.
// Ça permet d'utiliser les modales à la manette sans souris.

import type { NavAction } from './actions'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex="0"]'

export function handleModalNav(root: HTMLElement | null, action: NavAction): boolean {
  if (!root) return false
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (items.length === 0) return false
  const index = items.indexOf(document.activeElement as HTMLElement)

  switch (action) {
    case 'up':
    case 'left':
      items[index <= 0 ? items.length - 1 : index - 1].focus()
      return true
    case 'down':
    case 'right':
      items[index < 0 || index >= items.length - 1 ? 0 : index + 1].focus()
      return true
    case 'confirm':
      if (index >= 0) items[index].click()
      else items[0].focus()
      return true
    default:
      return false
  }
}
