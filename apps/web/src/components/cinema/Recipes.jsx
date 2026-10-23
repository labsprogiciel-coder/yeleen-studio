import Icon from '../../lib/icons.jsx'
import AssetThumb from '../AssetThumb.jsx'
import Menu from '../Menu.jsx'
import MentionTextarea from '../MentionTextarea.jsx'
import { ATTACH_PATTERN } from '../../lib/mentions.js'
import { jetons } from '../../lib/jobs.jsx'
import { RECIPES, recipeCost, recipeIssue } from '@studio/catalog/recipes'
import Cauri from '../Cauri.jsx'

const STEP_LABEL = { IN_QUEUE: 'En attente', IN_PROGRESS: 'En cours', COMPLETED: 'Terminé', FAILED: 'Échec', CANCELED: 'Annulé' }

/** Avancement du lancement en cours. Un workflow fal peut durer plusieurs minutes : on le dit tant qu'il n'est pas terminé. */
export function RunStrip({ jobs, onDone }) {
  const active = jobs.some((j) => j.status === 'IN_QUEUE' || j.status === 'IN_PROGRESS')
  return (
    <div className="rc-runbar">
      <ol className="rc-run" aria-label="Avancement du modèle">
        {jobs.map((j) => (
          <li key={j.id} data-s={j.status}>
            <span className="rc-dot" aria-hidden="true">{j.status === 'COMPLETED' ? <Icon name="check" size={12} /> : <Icon name="clock" size={12} />}</span>
            <b>{j.spec.recipe.label}</b>
            <span>{STEP_LABEL[j.status]}{active ? ' · cela peut prendre plusieurs minutes' : ''}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="rc-back" onClick={onDone}>Autres modèles</button>
    </div>
  )
}

/**
 * Formulaire d'un modèle : la même barre que les créations Image et Vidéo (pièces jointes en vignettes, + pour importer,
 * zone de texte, puces, bouton Générer avec le prix).
 */
export function RecipeForm({ id, texts, onText, photos, onAdd, onRemove, onPick, error, onRun }) {
  const r = RECIPES.find((x) => x.id === id)
  const issue = recipeIssue(id, { texts, photos })
  const cost = recipeCost(id)
  const attached = r.photos.filter((p) => photos[p.key])
  return (
    <div className="cn-comp">
      {attached.length > 0 && (
        <ul className="cn-strip" aria-label="Photos jointes">
          {attached.map((p) => (
            <li key={p.key}>
              <button type="button" className="cn-th" onClick={onAdd} aria-label={`${p.label} : ${photos[p.key].name}. Remplacer`} title={`${p.label} : remplacer`}>
                <AssetThumb asset={photos[p.key]} />
                <span className="cn-no" aria-hidden="true">{r.photos.indexOf(p) + 1}</span>
              </button>
              <button type="button" className="cn-rm" onClick={() => onRemove(p.key)} aria-label={`Retirer : ${p.label}`}><Icon name="close" size={11} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="cn-edit">
        <div className="cn-field">
          {r.texts.length ? r.texts.map((t) => (
            <MentionTextarea key={t.key} value={texts[t.key] ?? ''} onChange={(v) => onText(t.key, v)} items={[]} pattern={ATTACH_PATTERN} isRef={() => false} roles={{}} placeholder={t.placeholder} aria-label={t.label} rows={t.lines ? t.max : 2} />
          )) : (
            <p className="rc-notext">{r.blurb}. Ajoutez les photos avec +.</p>
          )}
          {(error || issue) && <p className={`cn-hint${error ? ' bad' : ''}`} role={error ? 'alert' : 'status'}>{error || issue}</p>}
        </div>
        <button type="button" className="cn-gen" disabled={Boolean(issue)} onClick={onRun} title={issue ?? undefined}>
          <b>Générer</b><span><Cauri size={16} />{jetons(cost)}</span>
        </button>
        <div className="cn-bar">
          <div className="cn-pair">
            <button type="button" onClick={onAdd} aria-label={`Ajouter : ${r.photos.map((p) => p.label.toLowerCase()).join(', ')}`} title={r.photos.map((p) => p.label).join(' · ')}><Icon name="plus" size={18} /></button>
          </div>
          <Menu items={RECIPES.map((x) => ({ id: x.id, title: x.name, icon: x.icon }))} value={id} onChange={onPick} label="Modèle" menuWidth={280} className="cn-chip" listClass="cn-pop"><Icon name={r.icon} size={16} /><span>{r.name}</span></Menu>
        </div>
      </div>
    </div>
  )
}
