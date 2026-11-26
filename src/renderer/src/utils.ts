// Petites fonctions utilitaires pour l'interface.

/**
 * Les erreurs renvoyées par le main arrivent sous la forme
 * "Error invoking remote method 'xxx': Error: message". On garde juste "message".
 */
export function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Nombre de colonnes de la grille (nombre de boîtes sur la première ligne). */
export function countColumns(grid: HTMLElement | null): number {
  if (!grid || grid.children.length === 0) return 1
  const firstTop = (grid.children[0] as HTMLElement).offsetTop
  let columns = 0
  for (const child of Array.from(grid.children)) {
    if ((child as HTMLElement).offsetTop !== firstTop) break
    columns++
  }
  return Math.max(1, columns)
}
