import { useEffect, useMemo, useState } from 'react'
import Menu from '../Menu.jsx'
import Segmented from '../Segmented.jsx'
import MentionTextarea from '../MentionTextarea.jsx'
import { Section, DropTile, GenerateButton, PromptBox } from '../GenPanel.jsx'
import { jetons, useJobs } from '../../lib/jobs.jsx'
import { findTool, isFileField, toolCheck, toolCost } from '@studio/catalog/tools'
import { findEditModel } from '@studio/catalog/edit-models'
import ModelLogo from '../ModelLogo.jsx'
import Icon from '../../lib/icons.jsx'
import { logoFor } from '../../lib/modelLogos.js'

const ICON = { image: 'img', images: 'img', video: 'vid', videos: 'vid', audio: 'mus' }
const one = (type) => type.replace(/s$/, '') // images → image
const lower = (label) => label.charAt(0).toLowerCase() + label.slice(1) // « Vidéo SDR » → « vidéo SDR »
// Un outil de l'interface peut regrouper plusieurs outils du catalogue (Parler : depuis un texte ou depuis un audio).
const VARIANTS = { speak: [{ id: 'speak-text', title: 'Script' }, { id: 'speak-audio', title: 'Ajouter un audio' }] }
export const toolJobs = (id) => VARIANTS[id] ?? (findTool(id) ? [{ id }] : null)

/** Durée (s) et plus petit côté (px, vidéo) d'un fichier, lus dans le navigateur pour refuser tôt ce que le serveur refuserait. */
function useMediaInfo(file, kind) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    if (!file) return setInfo(null)
    const url = URL.createObjectURL(file)
    const el = document.createElement(kind)
    el.preload = 'metadata'
    el.onloadedmetadata = () => setInfo({ secs: Math.round(el.duration * 10) / 10, short: Math.min(el.videoWidth, el.videoHeight) || null })
    el.onerror = () => setInfo(null)
    el.src = url
    return () => { el.removeAttribute('src'); URL.revokeObjectURL(url) }
  }, [file, kind])
  return info
}

// Formats que le serveur sait mesurer (apps/api/src/media.js) : les seuls acceptés par un outil à durée ou résolution limitée.
const MEASURED = { video: 'video/mp4,video/quicktime', audio: 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a' }

/** Tuile d'un fichier vidéo ou audio : remonte sa durée et son plus petit côté. */
function MediaTile({ field, file, onFile, onInfo, limited }) {
  const kind = one(field.type) === 'video' ? 'video' : 'audio'
  const info = useMediaInfo(file, kind)
  useEffect(() => onInfo(info), [info]) // eslint-disable-line react-hooks/exhaustive-deps
  return <DropTile icon={ICON[field.type]} label={field.label} accept={limited ? MEASURED[kind] : `${kind}/*`} file={file} onFile={onFile} required />
}

/** Liste de fichiers : une tuile par fichier posé, plus une tuile vide tant que le maximum n'est pas atteint. */
function FileList({ field, files = [], onFiles }) {
  const set = (i) => (f) => onFiles(f ? Object.assign([...files], { [i]: f }) : files.filter((_, j) => j !== i))
  const shown = files.length < field.max ? [...files, null] : files
  return shown.map((f, i) => (
    <DropTile key={i} icon={ICON[field.type]} label={f ? field.label : `${field.label} (${i + 1})`} accept={`${one(field.type)}/*`} file={f} onFile={set(i)} required={i < field.min} />
  ))
}

/** Un choix : en boutons s'il y en a peu, sinon dans une liste. */
function Choice({ field, value, onChange }) {
  const items = field.options.map((o) => ({ id: o.id, title: o.label }))
  const current = items.find((o) => o.id === value) ?? items[0]
  if (items.length <= 4) return <Segmented items={items} value={current.id} onChange={onChange} label={field.label} />
  return (
    <Menu items={items} value={current.id} onChange={onChange} label={field.label} menuWidth={260} className="ep-chip ep-ell">
      <span className="ep-ell">{current.title}</span>
    </Menu>
  )
}

/**
 * Choix du modèle d'un outil image (champ `model`, voir editModels.js) : le même sélecteur que celui des vidéos, avec le prix de
 * l'outil pour chaque modèle (`costOf(id)`, d'après les entrées en cours).
 */
function ModelChoice({ field, value, onChange, costOf }) {
  const current = findEditModel(value) ?? findEditModel(field.options[0].id)
  const items = field.options.map((o) => {
    const m = findEditModel(o.id)
    return { id: m.id, icon: 'img', logo: logoFor(m.id), title: m.name, desc: m.tagline, specs: [], price: { n: costOf(m.id) } }
  })
  return (
    <Menu items={items} value={current.id} onChange={onChange} label="Modèle" menuWidth={420}>
      {logoFor(current.id) ? <ModelLogo logo={logoFor(current.id)} size={18} /> : <Icon name="img" size={18} />}<span className="ep-ell">{current.name}</span>
    </Menu>
  )
}

/**
 * Formulaire d'un outil du catalogue (packages/catalog/src/tools.js) : fichiers, textes, choix et nombres, prix du catalogue,
 * puis une génération `tool` (les fichiers sont déposés chez fal avant l'envoi, voir lib/jobs.jsx). `onDone` : après l'envoi.
 */
export default function ToolForm({ tool: uiTool, onDone }) {
  const variants = toolJobs(uiTool)
  const [variant, setVariant] = useState(variants[0].id)
  const tool = findTool(variant)
  const { submit } = useJobs()
  const [values, setValues] = useState({})
  const [files, setFiles] = useState({})
  const [media, setMedia] = useState({}) // { [clé]: { secs, short } }
  const secs = Object.fromEntries(Object.entries(media).map(([k, m]) => [k, m?.secs]))
  const [error, setError] = useState('')
  const set = (key) => (v) => { setValues((o) => ({ ...o, [key]: v })); setError('') }
  const setFile = (key) => (f) => { setFiles((o) => ({ ...o, [key]: f })); setError('') }

  // Éditeur de clips : la fin se cale sur la durée du clip dès qu'elle est connue.
  const clip = secs.video
  useEffect(() => {
    if (tool.id === 'clip-editor' && clip > 0) setValues((o) => ({ ...o, start: o.start ?? 0, end: Math.min(o.end ?? clip, clip) }))
  }, [tool.id, clip])

  const fields = tool.inputs
  const inputs = useMemo(() => Object.fromEntries(fields.filter((f) => !isFileField(f)).map((f) => [f.key, values[f.key]])), [fields, values])
  // Le prix de certains modèles dépend du nombre d'images fournies : l'aperçu compte les fichiers posés (le serveur fait foi).
  const priced = useMemo(() => ({
    ...inputs,
    ...Object.fromEntries(fields.filter(isFileField).map((f) => [f.key, f.type.endsWith('s') ? (files[f.key] ?? []).filter(Boolean).map(() => 'fichier') : files[f.key] ? 'fichier' : undefined])),
  }), [fields, inputs, files])
  const cost = toolCost(tool, priced)
  const modelField = fields.find((f) => f.type === 'model')

  const blocker = (() => {
    for (const f of fields) {
      if (isFileField(f) && f.type.endsWith('s') ? (files[f.key]?.filter(Boolean).length ?? 0) < f.min : isFileField(f) && !files[f.key]) return `Ajoutez : ${lower(f.label)}.`
      if (f.type === 'text' && f.required && !values[f.key]?.trim()) return `Renseignez : ${lower(f.label)}.`
      if (f.type === 'text' && (values[f.key]?.length ?? 0) > f.max) return `${f.label} : ${f.max} caractères au maximum.`
      if (f.type === 'number' && !(typeof values[f.key] === 'number' && values[f.key] >= f.min && values[f.key] <= f.max)) return `${f.label} : entre ${f.min} et ${f.max}.`
    }
    const long = tool.maxSecs && Object.values(secs).find((s) => s > tool.maxSecs)
    if (long) return `${tool.maxSecs} s au maximum : raccourcissez le fichier (il dure ${Math.round(long)} s).`
    const tall = tool.maxP && Object.values(media).find((m) => m?.short > tool.maxP)
    if (tall) return `${tool.maxP}p au maximum : cette vidéo est en ${tall.short}p.`
    if (tool.id === 'clip-editor' && clip > 0 && values.end > clip) return `Le clip dure ${clip} s : la fin doit venir avant.`
    if (toolCheck(tool, inputs)) return 'La fin doit venir après le début.'
    return null
  })()

  const onGenerate = () => {
    const text = fields.filter((f) => f.type === 'text').map((f) => values[f.key]?.trim()).filter(Boolean).join(' / ')
    const chosen = fields.filter((f) => f.type === 'model' || f.type === 'select').map((f) => (f.options.find((o) => o.id === values[f.key]) ?? f.options[0]).label)
    const inputFiles = Object.fromEntries(fields.filter(isFileField).map((f) => [f.key, f.type.endsWith('s') ? files[f.key].filter(Boolean) : files[f.key]]))
    const count = tool.id === 'variations' ? Number(values.count ?? 2) : 1
    const r = submit({
      kind: tool.output, title: tool.name, prompt: text || tool.name, cost, count,
      meta: [tool.name, ...chosen].join(' · '),
      live: { kind: 'tool', modelId: tool.id, inputs, inputFiles },
    })
    if (!r.ok) return setError(`Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
    onDone?.()
  }

  const fileFields = fields.filter(isFileField)
  return (
    <div className="ep">
      {variants.length > 1 && (
        <Section id="tf-variant" title="Source">
          <Segmented items={variants} value={variant} onChange={(v) => { setVariant(v); setError('') }} label="Source" />
        </Section>
      )}

      {modelField && (
        <Section id="tf-model" title="Modèle">
          <ModelChoice field={modelField} value={values.model} onChange={set('model')} costOf={(id) => toolCost(tool, { ...priced, model: id })} />
        </Section>
      )}

      {fileFields.length > 0 && (
        <Section id="tf-files" title={tool.maxSecs ? `Fichiers · ${[`${tool.maxSecs} s`, tool.maxP && `${tool.maxP}p`].filter(Boolean).join(', ')} au maximum` : 'Fichiers'}>
          <div className={`ep-tiles${fileFields.length === 1 && !fileFields[0].type.endsWith('s') ? ' one' : ''}`}>
            {fileFields.map((f) => (f.type.endsWith('s')
              ? <FileList key={f.key} field={f} files={files[f.key]} onFiles={setFile(f.key)} />
              : f.type === 'image'
                ? <DropTile key={f.key} icon="img" label={f.label} accept="image/*" file={files[f.key] ?? null} onFile={setFile(f.key)} required />
                : <MediaTile key={f.key} field={f} file={files[f.key] ?? null} onFile={setFile(f.key)} onInfo={(m) => setMedia((o) => ({ ...o, [f.key]: m }))} limited={Boolean(tool.maxSecs || tool.maxP)} />))}
          </div>
        </Section>
      )}

      {fields.filter((f) => f.type === 'text').map((f) => (
        <Section key={f.key} id={`tf-${f.key}`} title={f.label}>
          <PromptBox canClear={Boolean(values[f.key])} onClear={() => set(f.key)('')} clearLabel={`Effacer : ${f.label}`}
            foot={<span className="tf-count" aria-live="polite">{(values[f.key] ?? '').length} / {f.max}</span>}>
            <MentionTextarea mentions={false} value={values[f.key] ?? ''} onChange={set(f.key)} placeholder={f.placeholder} aria-label={f.label} rows={f.max > 500 ? 4 : 2} data-prompt />
          </PromptBox>
        </Section>
      ))}

      {fields.filter((f) => f.type === 'number').length > 0 && (
        <Section id="tf-numbers" title={clip > 0 ? `Découpe · le clip dure ${clip} s` : 'Découpe'}>
          <div className="tf-nums">
            {fields.filter((f) => f.type === 'number').map((f) => (
              <label key={f.key} className="tf-num">
                <span>{f.label}</span>
                <input type="number" inputMode="decimal" min={f.min} max={clip > 0 ? clip : f.max} step={f.step ?? 1} value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key)(e.target.value === '' ? undefined : Number(e.target.value))} />
              </label>
            ))}
          </div>
        </Section>
      )}

      {fields.filter((f) => f.type === 'select').map((f) => (
        <Section key={f.key} id={`tf-${f.key}`} title={f.label}>
          <Choice field={f} value={values[f.key]} onChange={set(f.key)} />
        </Section>
      ))}

      {blocker && <p className="tf-hint" role="status">{blocker}</p>}
      <GenerateButton price={cost} disabled={Boolean(blocker)} error={error} title={blocker ?? undefined} onClick={onGenerate} />
    </div>
  )
}
