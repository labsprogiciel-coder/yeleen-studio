import Icon from '../lib/icons.jsx'
import useTabKeys from '../lib/useTabKeys.js'
import { MAX_PLANS } from '../lib/useGenSettings.js'
import '../styles/plan-tabs.css'

/**
 * Intitulé « Plan(s) », onglets numérotés (quand il y a plusieurs plans) et bouton d'ajout, pilotés par `useGenSettings`.
 * Partagé par l'éditeur Vidéo, l'écran Cinéma et l'éditeur de modèles ; `controls` : id de la zone de texte du plan affiché ;
 * `level` : niveau du titre (3 dans l'éditeur de modèles, dont les sections ont des titres h3).
 */
export default function PlanTabs({ s, single = false, singleReason, controls = 'plan-panel', headingId = 'ep-plan', level = 2 }) {
  const onTabKeys = useTabKeys()
  const H = `h${level}`
  return (
    <div className="ep-plans">
      <H id={headingId}>{s.multi ? 'Plans' : 'Plan'}</H>
      {s.multi && (
        <div className="ep-ptabs" role="tablist" aria-label="Plans" onKeyDown={onTabKeys}>
          {s.plans.map((_, i) => (
            <span key={i} className={`ep-ptab${i === s.active ? ' on' : ''}`}>
              <button type="button" id={`plan-tab-${i}`} role="tab" aria-selected={i === s.active} aria-controls={controls} tabIndex={i === s.active ? 0 : -1} aria-label={`Plan ${i + 1}`} onClick={() => s.setActive(i)}>{i + 1}</button>
              {i === s.active && <button type="button" className="ep-rm" aria-label={`Supprimer le plan ${i + 1}`} onClick={() => s.removePlan(i)}><Icon name="close" size={12} /></button>}
            </span>
          ))}
        </div>
      )}
      <button type="button" className="ep-plus" aria-label="Ajouter un plan" title={s.multiAllowed && !single ? undefined : singleReason ?? 'Ce modèle ne génère qu’un seul plan par vidéo'} disabled={!s.multiAllowed || single || s.plans.length >= MAX_PLANS} onClick={s.addPlan}><Icon name="plus" size={16} /></button>
    </div>
  )
}
