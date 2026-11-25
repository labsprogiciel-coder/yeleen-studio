import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Pages publiques chargées à la demande (accueil, /terms, /privacy) : le navigateur n'a pas trouvé l'ancre à temps, on descend
 * à la section (#tarifs, #mentions-legales…) une fois la page affichée. Arrivée sur une nouvelle page : saut direct, sans
 * l'animation de html{scroll-behavior:smooth} ; ancre dans la même page : défilement doux. Un simple lien ouvre la page en haut.
 */
/** Ancre décodée, ou null si elle est mal formée (« #% ») : traitée comme une ancre absente. */
const safeDecode = (id) => { try { return decodeURIComponent(id) } catch { return null } }

export default function useHashScroll() {
  const { pathname, hash, key } = useLocation()
  const navType = useNavigationType()
  const shown = useRef(null) // dernière adresse traitée par ce composant (une même instance sert plusieurs routes)
  useEffect(() => {
    // Nouvelle page : autre chemin, ou même adresse traitée à nouveau (composant remonté, StrictMode en développement).
    const arrived = shown.current?.pathname !== pathname || shown.current.key === key
    shown.current = { pathname, key }
    const el = hash && document.getElementById(safeDecode(hash.slice(1)))
    if (!el) {
      if (navType === 'PUSH') window.scrollTo({ top: 0, behavior: 'instant' })
      return undefined
    }
    if (!arrived) { el.scrollIntoView(); return undefined }
    // Nouvelle page : les polices et les images arrivent encore et décalent le texte au-dessus de la section. Pendant un court
    // moment, on la remet en place à chaque changement de taille de la page, tant que le visiteur n'a pas défilé lui-même.
    const place = () => el.scrollIntoView({ behavior: 'instant' })
    place()
    const ro = new ResizeObserver(place)
    ro.observe(document.body)
    const INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown']
    const stop = () => { ro.disconnect(); clearTimeout(timer); INPUT.forEach((t) => window.removeEventListener(t, stop)) }
    const timer = setTimeout(stop, 2000)
    INPUT.forEach((t) => window.addEventListener(t, stop, { passive: true }))
    return stop
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}
