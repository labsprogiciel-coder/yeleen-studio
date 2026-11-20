/**
 * Barre latérale du studio Cinéma : réduite (icônes seules) ou agrandie (icône et libellé). Le choix est retenu dans le navigateur ;
 * sans choix enregistré, elle est agrandie sur grand écran (>= 1280 px) et réduite ailleurs.
 */
export const RAIL_KEY = 'studio.cinema.rail'
export const WIDE = 1280

/** Valeur enregistrée ('collapsed' | 'expanded' | autre) et largeur de la fenêtre -> la barre est-elle réduite ? */
export function initialCollapsed(stored, width) {
  if (stored === 'collapsed') return true
  if (stored === 'expanded') return false
  return !(Number(width) >= WIDE)
}

export function readRail() {
  let stored = null
  try { stored = localStorage.getItem(RAIL_KEY) } catch { /* stockage indisponible */ }
  return initialCollapsed(stored, typeof window === 'undefined' ? 0 : window.innerWidth)
}

export function saveRail(collapsed) {
  try { localStorage.setItem(RAIL_KEY, collapsed ? 'collapsed' : 'expanded') } catch { /* stockage indisponible */ }
}
