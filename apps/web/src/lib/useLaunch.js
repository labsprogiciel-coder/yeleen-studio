import { useCallback, useEffect, useRef, useState } from 'react'
import { LAUNCH_HOLD_MS, launched } from './launchGuard.js'
import { useJobs } from './jobs.jsx'

/**
 * Bouton qui lance une génération payante : `[busy, run]`. Dès le premier appui `busy` passe à vrai (le bouton montre « Envoi… ») ;
 * un second appui est ignoré, même avant le rendu suivant. `fn` peut être asynchrone (lecture des fichiers) et rend `true`, ou le
 * résultat de `submit`, quand la génération est partie : le bouton reste alors occupé tant que le moteur envoie la demande au
 * service (`sent`, voir lib/jobs.jsx), puis `LAUNCH_HOLD_MS` de plus, pour qu'un appui tardif ne lance rien. Refus (local, ou du
 * service à l'envoi) ou erreur : il se libère tout de suite.
 * Le bouton occupé garde le focus : on lui met `aria-disabled` plutôt que `disabled` (voir `busyProps`), les appuis sont ignorés ici.
 */
export function useLaunch(fn) {
  const [busy, setBusy] = useState(false)
  const jobs = useJobs()
  const lastSent = useRef(null)
  lastSent.current = jobs?.lastSent
  const lock = useRef(false)
  const timer = useRef(null)
  const alive = useRef(true)
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [])
  const run = useCallback(async (...args) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    const free = () => { lock.current = false; if (alive.current) setBusy(false) }
    let ok = false
    try {
      const r = await latest.current(...args)
      ok = launched(r)
      // L'envoi au service : celui du résultat de `submit`, sinon le dernier que le moteur a commencé (gestionnaire qui rend `true`).
      if (ok) ok = (await (r?.sent ?? lastSent.current?.())) !== false
    } finally {
      if (ok) timer.current = setTimeout(free, LAUNCH_HOLD_MS)
      else free()
    }
  }, [])
  return [busy, run]
}

/** Attributs d'un bouton occupé : annoncé occupé et inactif, sans `disabled` (qui lui ferait perdre le focus du clavier). */
export const busyProps = (busy) => (busy ? { 'aria-busy': true, 'aria-disabled': true } : {})
