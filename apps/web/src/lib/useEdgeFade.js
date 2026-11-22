import { useCallback, useEffect, useRef } from 'react'

/**
 * Rangée qui défile de côté sans barre visible : écrit dans `data-fade` (« l », « r », « lr » ou vide) les côtés où il reste du
 * contenu caché, pour que la feuille de style estompe ce bord-là seulement. Renvoie `[ref, update]` : `ref` va sur la rangée,
 * `update` sur son `onScroll`. La mesure est refaite quand la fenêtre change de taille et quand `deps` change (contenu de la rangée).
 */
export default function useEdgeFade(deps = []) {
  const ref = useRef(null)
  const update = useCallback(() => {
    const e = ref.current
    if (e) e.dataset.fade = `${e.scrollLeft > 1 ? 'l' : ''}${e.scrollLeft + e.clientWidth < e.scrollWidth - 1 ? 'r' : ''}`
  }, [])
  useEffect(() => {
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return [ref, update]
}
