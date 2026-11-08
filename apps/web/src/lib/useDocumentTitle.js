import { useEffect } from 'react'

const SITE = 'Qreativ'

/** Titre de l'onglet propre à chaque écran (« Spot pub · Qreativ »), pour s'y retrouver et pour les lecteurs d'écran. */
export default function useDocumentTitle(page) {
  useEffect(() => {
    document.title = page ? `${page} · ${SITE}` : SITE
  }, [page])
}
