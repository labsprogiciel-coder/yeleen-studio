import Icon from '../../lib/icons.jsx'
import Menu from '../Menu.jsx'
import MentionTextarea from '../MentionTextarea.jsx'
import { Section, DropTile, PromptBox, GenerateButton } from '../GenPanel.jsx'
import { RECIPES, recipeCost, recipeIssue } from '@studio/catalog/recipes'
import { splitLines } from '@studio/catalog/workflows'

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
 * Formulaire d'un modèle, sur le modèle du Générateur de vidéos : le modèle choisi, une case par photo (la bibliothèque s'ouvre
 * au toucher), le cadre de texte de chaque entrée (avec l'étincelle « Améliorer » sauf pour les listes et les textes à garder tels
 * quels), puis Générer avec le prix. `onPhoto(clé, asset)` : null retire la photo.
 */
export function RecipeForm({ id, texts, onText, photos, onPhoto, onPick, error, onRun }) {
  const r = RECIPES.find((x) => x.id === id)
  const issue = recipeIssue(id, { texts, photos })
  const cost = recipeCost(id)
  return (
    <div className="ep">
      <Section id="rc-model" title="Modèle">
        <Menu items={RECIPES.map((x) => ({ id: x.id, title: x.name, icon: x.icon }))} value={id} onChange={onPick} label="Modèle" menuWidth={280}>
          <Icon name={r.icon} size={18} /><span className="ep-ell">{r.name}</span>
        </Menu>
      </Section>

      <Section id="rc-photos" title={r.photos.length > 1 ? 'Photos' : 'Photo'}>
        <div className={`ep-tiles${r.photos.length === 1 ? ' one' : ''}`}>
          {r.photos.map((p) => (
            <DropTile key={p.key} icon="img" label={p.label} accept="image/*" file={null} asset={photos[p.key] ?? null} onFile={(f, a) => onPhoto(p.key, f ? a : null)} required />
          ))}
        </div>
      </Section>

      {r.texts.map((t) => (
        <Section key={t.key} id={`rc-${t.key}`} title={t.label}>
          <PromptBox canClear={Boolean(texts[t.key])} onClear={() => onText(t.key, '')} clearLabel={`Effacer : ${t.label}`}
            enhance={t.enhance ? { value: texts[t.key] ?? '', onChange: (v) => onText(t.key, v), kind: 'template', workflowId: r.workflow.id, field: t.key } : null}
            foot={t.lines && <span className="tf-count" aria-live="polite">{splitLines(texts[t.key]).length} / {t.max}</span>}>
            <MentionTextarea mentions={false} value={texts[t.key] ?? ''} onChange={(v) => onText(t.key, v)} placeholder={t.placeholder} aria-label={t.label} rows={t.lines ? t.max : 3} data-prompt />
          </PromptBox>
        </Section>
      ))}

      {issue && <p className="tf-hint" role="status">{issue}</p>}
      <GenerateButton price={cost} disabled={Boolean(issue)} error={error} title={issue ?? undefined} onClick={onRun} />
    </div>
  )
}
