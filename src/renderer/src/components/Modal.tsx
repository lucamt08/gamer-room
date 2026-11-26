// Fenêtre modale générique (fond sombre + boîte centrée).
import { forwardRef, useEffect, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
}

const Modal = forwardRef<HTMLDivElement, Props>(function Modal({ title, onClose, children }, ref) {
  // Au moment de l'ouverture, on met le focus sur le premier élément (utile à la manette)
  useEffect(() => {
    const root = typeof ref === 'object' ? ref?.current : null
    root?.querySelector<HTMLElement>('input, button')?.focus()
  }, [ref])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={ref} role="dialog" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
})

export default Modal
