import { useEffect, useMemo, useState } from 'react'
import Icon from '../../lib/icons.jsx'
import Menu from '../Menu.jsx'
import Segmented from '../Segmented.jsx'
import MentionTextarea from '../MentionTextarea.jsx'
import { Section, DropTile, GenerateButton } from '../GenPanel.jsx'
import { jetons, useJobs } from '../../lib/jobs.jsx'
import useMediaSecs from '../../lib/useMediaSecs.js'
import { findTool, isFileField, toolCheck, toolCost } from '@studio/catalog/tools'

const ICON = { image: 'img', images: 'img', video: 'vid', videos: 'vid', audio: 'mus' }
const one = (type) => type.replace(/s$/, '') // images → image
// Un outil de l'interface peut regrouper plusieurs outils du catalogue (Parler : depuis un texte ou depuis un audio).
const VARIANTS = { speak: [{ id: 'speak-text', title: 'Script' }, { id: 'speak-audio', title: 'Ajouter un audio' }] }
export const toolJobs = (id) => VARIANTS[id] ?? (findTool(id) ? [{ id }] : null)

/** Tuile d'un fichier vidéo ou audio : mesure sa durée dans le navigateur (le serveur ne la mesure pas encore). */
function MediaTile({ field, file, onFile, onSecs }) {
  const secs = useMediaSecs(file, one(field.type) === 'video' ? 'video' : 'audio')
  useEffect(() => onSecs(secs), [secs]) // eslint-disable-line react-hooks/exhaustive-deps
  return <DropTile icon={ICON[field.type]} label={field.label} accept={`${one(field.type)}/*`} file={file} onFile={onFile} required />
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
  const [secs, setSecs] = useState({})
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
  const cost = toolCost(tool, inputs)

  const blocker = (() => {
    for (const f of fields) {
      if (isFileField(f) && f.type.endsWith('s') ? (files[f.key]?.filter(Boolean).length ?? 0) < f.min : isFileField(f) && !files[f.key]) return `Ajoutez : ${f.label.toLowerCase()}.`
      if (f.type === 'text' && f.required && !values[f.key]?.trim()) return `Renseignez : ${f.label.toLowerCase()}.`
      if (f.type === 'text' && (values[f.key]?.length ?? 0) > f.max) return `${f.label} : ${f.max} caractères au maximum.`
      if (f.type === 'number' && !(typeof values[f.key] === 'number' && values[f.key] >= f.min && values[f.key] <= f.max)) return `${f.label} : entre ${f.min} et ${f.max}.`
    }
    const long = tool.maxSecs && Object.values(secs).find((s) => s > tool.maxSecs)
    if (long) return `${tool.maxSecs} s au maximum : raccourcissez le fichier (il dure ${Math.round(long)} s).`
    if (tool.id === 'clip-editor' && clip > 0 && values.end > clip) return `Le clip dure ${clip} s : la fin doit venir avant.`
    if (toolCheck(tool, inputs)) return 'La fin doit venir après le début.'
    return null
  })()

  const onGenerate = () => {
    const text = fields.filter((f) => f.type === 'text').map((f) => values[f.key]?.trim()).filter(Boolean).join(' / ')
    const chosen = fields.filter((f) => f.type === 'select').map((f) => (f.options.find((o) => o.id === values[f.key]) ?? f.options[0]).label)
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

      {fileFields.length > 0 && (
        <Section id="tf-files" title={tool.maxSecs ? `Fichiers · ${tool.maxSecs} s au maximum` : 'Fichiers'}>
          <div className={`ep-tiles${fileFields.length === 1 && !fileFields[0].type.endsWith('s') ? ' one' : ''}`}>
            {fileFields.map((f) => (f.type.endsWith('s')
              ? <FileList key={f.key} field={f} files={files[f.key]} onFiles={setFile(f.key)} />
              : f.type === 'image'
                ? <DropTile key={f.key} icon="img" label={f.label} accept="image/*" file={files[f.key] ?? null} onFile={setFile(f.key)} required />
                : <MediaTile key={f.key} field={f} file={files[f.key] ?? null} onFile={setFile(f.key)} onSecs={(s) => setSecs((o) => ({ ...o, [f.key]: s }))} />))}
          </div>
        </Section>
      )}

      {fields.filter((f) => f.type === 'text').map((f) => (
        <Section key={f.key} id={`tf-${f.key}`} title={f.label}>
          <div className="ep-prompt">
            <MentionTextarea mentions={false} value={values[f.key] ?? ''} onChange={set(f.key)} placeholder={f.placeholder} aria-label={f.label} rows={f.max > 500 ? 4 : 2} data-prompt />
            <div className="ep-pfoot">
              <span className="tf-count" aria-live="polite">{(values[f.key] ?? '').length} / {f.max}</span>
              <button type="button" className="ep-clear" aria-label={`Effacer : ${f.label}`} disabled={!values[f.key]} onClick={() => set(f.key)('')}><Icon name="close" size={14} /></button>
            </div>
          </div>
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
