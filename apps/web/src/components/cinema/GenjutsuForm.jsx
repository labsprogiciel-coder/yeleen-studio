import { useState } from 'react'
import { findTool, toolCost } from '@studio/catalog/tools'
import Segmented from '../Segmented.jsx'
import Icon from '../../lib/icons.jsx'
import { Section, DropTile, GenerateButton } from '../GenPanel.jsx'
import { jetons, useJobs } from '../../lib/jobs.jsx'

const RES = [{ id: '480p', title: '480p' }, { id: '720p', title: '720p' }]

/**
 * Vidéo à refaire par Genjutsu (Higgsfield) : la vidéo du modèle est la source. L'utilisateur n'ajoute qu'une photo par rôle (dans
 * l'ordre des rôles) et choisit la résolution ; la source, sa durée et la consigne sont fixées par le serveur (voir apps/api, /jobs
 * avec `template`). Le prix suit la durée de la source. `onClose` : revenir à l'outil sans la vidéo ; `onDone` : après l'envoi.
 */
export default function GenjutsuForm({ template: t, onClose, onDone }) {
  const tool = findTool(t.genjutsu.tool)
  const roles = t.genjutsu.roles
  const [photos, setPhotos] = useState(() => roles.map(() => null))
  const [resolution, setResolution] = useState('480p')
  const [error, setError] = useState('')
  const { submit } = useJobs()
  const cost = toolCost(tool, { resolution }, t.genjutsu.secs)
  const missing = roles.find((_, i) => !photos[i])
  const blocker = missing ? `Ajoutez : ${missing.charAt(0).toLowerCase()}${missing.slice(1)}.` : null
  const swap = tool.id === 'object-swap'

  const setPhoto = (i) => (f) => { setPhotos((p) => p.map((x, j) => (j === i ? f : x))); setError('') }
  const onGenerate = () => {
    const r = submit({
      kind: 'video', title: t.name, prompt: t.name, cost,
      meta: [tool.name, `${String(Math.round(t.genjutsu.secs * 10) / 10).replace('.', ',')} s`, resolution].join(' · '),
      live: { kind: 'tool', modelId: tool.id, template: t.id, inputs: { resolution }, inputFiles: { images: photos } },
    })
    if (!r.ok) return setError(`Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
    onDone?.()
  }

  return (
    <div className="ep">
      <Section id="gj-from" title="Vidéo à refaire">
        <div className="ep-from">
          <video src={`${t.video}#t=0.1`} muted loop playsInline preload="metadata" aria-hidden="true" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
          <span><small>{swap ? 'Votre produit dans la vidéo' : 'Vous dans la vidéo'}</small><b>{t.name}</b></span>
          <button type="button" className="ep-x" aria-label={`Ne plus suivre « ${t.name} »`} title="Choisir votre propre vidéo" onClick={onClose}><Icon name="close" size={12} /></button>
        </div>
      </Section>

      <Section id="gj-photos" title={roles.length > 1 ? `Photos · une par personne (${roles.length})` : swap ? 'Photo du produit' : 'Votre photo'}>
        <div className={`ep-tiles${roles.length === 1 ? ' one' : ''}`}>
          {roles.map((role, i) => <DropTile key={role} icon="img" label={role} accept="image/*" file={photos[i]} onFile={setPhoto(i)} required />)}
        </div>
        <p className="tf-hint">{swap ? 'Une photo nette du produit, de face, sur fond simple.' : 'Une photo nette du visage et du corps, de face : la personne refait chaque geste de la vidéo.'}</p>
      </Section>

      <Section id="gj-res" title="Résolution">
        <Segmented items={RES} value={resolution} onChange={setResolution} label="Résolution" />
      </Section>

      {blocker && <p className="tf-hint" role="status">{blocker}</p>}
      <GenerateButton price={cost} disabled={Boolean(blocker)} error={error} title={blocker ?? undefined} onClick={onGenerate} />
    </div>
  )
}
