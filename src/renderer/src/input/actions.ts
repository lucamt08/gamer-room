// Les "actions" de navigation, communes au clavier et à la manette.
// Le reste de l'interface ne réagit qu'à ces actions : il ne sait pas si
// elles viennent d'une touche ou d'un bouton de manette.

export type NavAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm' // Entrée / bouton A (croix sur PlayStation)
  | 'back' // Échap / bouton B (rond sur PlayStation)
  | 'edit' // touche E / bouton Y (triangle)
  | 'cover' // touche C / bouton X (carré)
  | 'settings' // touche P / bouton Start (Options)
  | 'add' // touche A / bouton Select (Share)
