// Point d'entrée de l'interface React.
// La même interface sert à deux fenêtres :
//  - le hub (adresse normale) ;
//  - le menu en jeu (adresse qui finit par « #overlay », voir main/gameOverlay.ts).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import GameOverlay from './components/GameOverlay'
import './styles.css'

const isOverlay = window.location.hash === '#overlay'
// Le menu en jeu a un fond transparent : on voit le jeu derrière
if (isOverlay) document.documentElement.classList.add('overlay-window')

createRoot(document.getElementById('root')!).render(<StrictMode>{isOverlay ? <GameOverlay /> : <App />}</StrictMode>)
