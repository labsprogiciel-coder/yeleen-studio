import { useSyncExternalStore } from 'react'

/** Vrai tant que la fenêtre répond à la requête média `query` (ex. « (max-width:900px) ») ; suit les changements de taille. */
export default function useMedia(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia?.(query)
      mq?.addEventListener('change', onChange)
      return () => mq?.removeEventListener('change', onChange)
    },
    () => Boolean(window.matchMedia?.(query).matches),
    () => false,
  )
}
