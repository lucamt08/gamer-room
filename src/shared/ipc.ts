// Noms des "canaux" de communication entre l'interface (renderer) et le
// processus principal (main). On les met ici pour éviter les fautes de frappe :
// main/ipc.ts et preload/index.ts utilisent les mêmes constantes.

export const IPC = {
  // Bibliothèque
  getGames: 'library:get',
  pickExecutable: 'library:pick',
  addGame: 'library:add',
  updateGame: 'library:update',
  removeGame: 'library:remove',
  gameUpdated: 'library:game-updated', // main → renderer (un jeu a été corrigé en arrière-plan)

  // Jeux Steam installés
  steamListGames: 'steam:list',
  steamAddGames: 'steam:add',

  // Lancement
  launchGame: 'game:launch',
  killGame: 'game:kill',
  runningState: 'game:state', // main → renderer

  // SteamGridDB
  sgdbSearch: 'sgdb:search',
  sgdbGrids: 'sgdb:grids',
  sgdbSetCover: 'sgdb:set-cover',
  sgdbAutoCover: 'sgdb:auto-cover',

  // Paramètres
  getSettings: 'settings:get',
  saveSettings: 'settings:save',

  // Fenêtre du hub
  toggleFullscreen: 'window:toggle-fullscreen',
  setFullscreen: 'window:set-fullscreen',

  // Mise à jour
  updateStatus: 'update:status', // main → renderer
  checkUpdate: 'update:check',
  downloadUpdate: 'update:download',
  installUpdate: 'update:install',

  // Flawless Widescreen
  fwsGameInfo: 'fws:game-info',
  fwsStatus: 'fws:status',
  fwsAuthorize: 'fws:authorize',
  fwsPickFolder: 'fws:pick-folder',

  // Menu en jeu (appui long sur le bouton Guide / PS)
  overlayOpened: 'overlay:opened', // main → menu (le menu vient de s'ouvrir, avec les infos du jeu)
  overlayAction: 'overlay:action',

  getVersion: 'app:version'
} as const
