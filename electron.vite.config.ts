// Configuration d'electron-vite : il compile 3 morceaux séparés.
//  - main     : le processus principal (Node.js, accès au système)
//  - preload  : le "pont" sécurisé entre main et l'interface
//  - renderer : l'interface React (ce qui s'affiche dans la fenêtre)
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    plugins: [react()]
  }
})
