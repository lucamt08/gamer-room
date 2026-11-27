// Compteur d'images par seconde (FPS) de l'interface, pour voir si le hub rame.
// Touche F3 : affiche / cache. Il est caché au démarrage et ne calcule rien tant qu'il est caché.
import { useEffect, useState } from 'react'

export default function FpsCounter() {
  const [visible, setVisible] = useState(false)
  const [fps, setFps] = useState(0)

  // F3 : affiche ou cache le compteur
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'F3') return
      event.preventDefault()
      setVisible((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Compte les images dessinées : le navigateur appelle requestAnimationFrame une fois par image.
  // Toutes les demi-secondes, on divise le nombre d'images par le temps écoulé.
  useEffect(() => {
    if (!visible) return
    let frames = 0
    let start = performance.now()
    let id = requestAnimationFrame(function tick(now) {
      frames++
      if (now - start >= 500) {
        setFps(Math.round((frames * 1000) / (now - start)))
        frames = 0
        start = now
      }
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [visible])

  if (!visible) return null
  // Couleur : vert si fluide, orange si moyen, rouge si ça rame
  const level = fps >= 50 ? 'good' : fps >= 30 ? 'medium' : 'bad'
  return (
    <div className={`fps-counter ${level}`} title="Images par seconde de Gamer Room (F3 pour cacher)">
      {fps} FPS
    </div>
  )
}
