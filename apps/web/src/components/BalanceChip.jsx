import { useJobs } from '../lib/jobs.jsx'
import { useRecharge } from '../lib/rechargeDialog.jsx'
import Cauri from './Cauri.jsx'
import { BalanceNumber, useBalance } from './BalanceValue.jsx'

/** Solde de cauris et nombre de générations en cours, visibles depuis tous les outils. Ouvre la recharge. */
export default function BalanceChip() {
  const { running, queued } = useJobs()
  const view = useBalance()
  const { openRecharge } = useRecharge()
  const busy = running + queued
  const label = view.failed ? 'Solde indisponible. Réessayer' : `Solde : ${view.spoken}${busy ? `, ${busy} génération${busy > 1 ? 's' : ''} en cours` : ''}. Recharger`
  return (
    <button type="button" className="bal" aria-haspopup={view.failed ? undefined : 'dialog'} onClick={() => (view.failed ? view.reload() : openRecharge())} aria-label={label} title={view.failed ? label : undefined}>
      <Cauri size={16} />
      <b><BalanceNumber view={view} /></b>
      {busy > 0 && <span className="bal-busy"><i />{busy} en cours</span>}
    </button>
  )
}
