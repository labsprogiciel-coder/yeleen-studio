import { useEffect, useRef } from 'react'
import Rail from './Rail.jsx'

/**
 * Barre latérale du studio sur téléphone et tablette : un volet à gauche, par-dessus la page assombrie. Fenêtre modale native
 * (<dialog>) : le focus y entre et y reste, Échap la ferme, et il revient au bouton du menu à la fermeture. Elle se ferme aussi
 * d'un toucher sur le fond, par son bouton × et après chaque choix (Rail appelle `onClose`). La page ne défile pas tant qu'elle est ouverte.
 * `open` et `onClose` viennent de Cinéma ; le reste des propriétés va à Rail.
 */
export default function RailDrawer({ open, onClose, ...rail }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (open && !d.open) {
      d.showModal()
      d.querySelector('.cx-rail-x')?.focus() // le bouton × d'abord, plutôt que le logo (un lien qui quitte l'écran)
    }
    if (!open && d.open) d.close()
  }, [open])
  useEffect(() => {
    if (!open) return undefined
    const root = document.documentElement
    const before = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = before }
  }, [open])
  // Fermeture immédiate (avant l'action choisie) : le focus est rendu au bouton du menu avant qu'une autre fenêtre ne s'ouvre.
  const close = () => { if (ref.current?.open) ref.current.close(); else onClose() }
  return (
    <dialog ref={ref} className="cx-drawer" aria-label="Menu" onClose={onClose} onClick={(e) => e.target === ref.current && close()}>
      <Rail {...rail} collapsed={false} onClose={close} />
    </dialog>
  )
}
