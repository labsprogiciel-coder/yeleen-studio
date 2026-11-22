import { jetons, useJobs } from '../lib/jobs.jsx'
import Icon from '../lib/icons.jsx'

/**
 * Le solde tel qu'on le connaît : jamais un chiffre inventé. Tant que le serveur ne l'a pas rendu, une barre qui pulse ; s'il
 * n'a pas pu être lu, « — » et une flèche (le bouton qui l'affiche réessaie au lieu d'ouvrir la recharge).
 */
export function useBalance() {
  const { balance, wallet, reloadWallet } = useJobs()
  const known = balance != null
  const failed = !known && wallet === 'error'
  const spoken = known ? `${jetons(balance)} cauris` : failed ? 'indisponible' : 'en cours de chargement'
  return { balance, known, failed, spoken, reload: reloadWallet }
}

/** Le chiffre du solde, ou sa place pendant le chargement, ou « — ↻ » s'il est illisible. */
export function BalanceNumber({ view }) {
  if (view.known) return jetons(view.balance)
  if (view.failed) return <span className="bal-x">—<Icon name="revert" size={15} /></span>
  return <i className="bal-sk" aria-hidden="true" />
}
