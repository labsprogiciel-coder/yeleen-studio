import { useEffect, useRef } from 'react'
import { isLeavingClick } from '../../lib/adminTemplates.js'

/**
 * Tant que `active` est vrai, demande confirmation avant de quitter la page : rechargement ou fermeture (beforeunload), clic sur un
 * lien de l'application (barre latérale, en-tête, « Essayer »…) et boutons Précédent / Suivant du navigateur.
 * L'application utilise BrowserRouter (pas de useBlocker) : les clics sont arrêtés à la capture, avant le Link de React Router ;
 * pour Précédent / Suivant, l'évènement popstate est arrêté avant le routeur puis l'adresse est remise à sa place.
 */
export default function useLeaveGuard(active, message) {
  const msg = useRef(message)
  msg.current = message
  useEffect(() => {
    if (!active) return undefined
    const idx = window.history.state?.idx
    let restoring = false
    const unload = (e) => { e.preventDefault(); e.returnValue = '' }
    const click = (e) => {
      const a = e.target?.closest?.('a[href]')
      if (!isLeavingClick(e, a, window.location.href)) return
      if (window.confirm(msg.current)) return
      e.preventDefault()
      e.stopPropagation()
    }
    const pop = (e) => {
      if (restoring) { restoring = false; e.stopImmediatePropagation(); return }
      if (window.confirm(msg.current)) return
      e.stopImmediatePropagation()
      const now = e.state?.idx
      if (typeof idx === 'number' && typeof now === 'number' && now !== idx) {
        restoring = true
        window.history.go(idx - now)
      }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', click, true)
    window.addEventListener('popstate', pop, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', click, true)
      window.removeEventListener('popstate', pop, true)
    }
  }, [active])
}
