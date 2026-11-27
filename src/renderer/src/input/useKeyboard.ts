// Transforme les touches du clavier en actions de navigation.
import { useEffect, useRef } from 'react'
import type { NavAction } from './actions'

const KEYS: Record<string, NavAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  Escape: 'back',
  e: 'edit',
  c: 'cover',
  p: 'settings',
  a: 'add',
  i: 'details'
}

/** Vrai si l'utilisateur est en train d'écrire dans un champ texte. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

export function useKeyboard(onAction: (action: NavAction) => void, enabled: boolean): void {
  // On garde la dernière version de la fonction sans réabonner l'écouteur
  const handler = useRef(onAction)
  handler.current = onAction

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      const action = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key]
      if (!action) return

      // Dans un champ texte, on laisse les touches normales fonctionner
      // (sauf Échap pour fermer, et haut/bas pour changer de champ).
      if (isTyping(event.target)) {
        if (!['back', 'up', 'down'].includes(action)) return
        // Les cases à cocher sont des <input> mais n'ont pas de texte : Entrée = cocher, on laisse faire
      }
      event.preventDefault()
      handler.current(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
