import { LIMITS, slotTokens } from '@studio/catalog/template-slots'
import Icon from '../../lib/icons.jsx'
import { DropTile } from '../../components/GenPanel.jsx'
import { acceptFor, addInput, allowedAdds, inputTitle, patchInput, pseudoAsset, removeInput, setMode, toggleSource } from '../../lib/adminTemplates.js'

/**
 * Section « Entrées » de l'éditeur (générateur vidéo) : une carte par entrée, dans l'ordre (les photos de départ `source` sont
 * montrées dans la carte de l'image créée qui s'en sert), et les boutons d'ajout de ce que le modèle accepte.
 */
export default function TemplateInputs({ model, inputs, onChange, onPatch, upload, uploading }) {
  const tokens = slotTokens(inputs)
  const cards = [...inputs].filter((i) => i.slot !== 'source').sort((a, b) => a.idx - b.idx)
  const adds = allowedAdds(model, inputs)
  // Pendant l'envoi d'un fichier d'entrée, les entrées ne sont ni retirées ni changées de mode : leurs numéros restent ceux de l'envoi.
  const locked = Object.keys(uploading ?? {}).some((k) => k.startsWith('input-'))
  return (
    <section className="adm-card tm-sec" aria-labelledby="tm-in-t">
      <h3 id="tm-in-t">Entrées <small>{model ? `selon ${model.name}` : ''}</small></h3>
      {!cards.length && <p className="tm-note">Aucune entrée : le modèle vidéo ne reçoit que le texte des plans.</p>}
      {cards.map((i) => (
        <InputCard key={i.idx} input={i} inputs={inputs} token={tokens[i.idx]} onChange={onChange} onPatch={onPatch} upload={upload} uploading={Boolean(uploading?.[`input-${i.idx}`])} locked={locked} />
      ))}
      {adds.length > 0 && (
        <div className="tm-adds">
          {adds.map((a) => (
            <button key={a.id} type="button" className="adm-btn sm" onClick={() => onChange(addInput(inputs, a))}><Icon name="plus" size={14} />{a.label}</button>
          ))}
        </div>
      )}
    </section>
  )
}

const MODE_LABEL = { fixed: 'Fixe', user: 'À fournir', generated: 'Créée (Krea 3)' }
const KIND_ICON = { image: 'img', video: 'vid', audio: 'mus' }
const ASK = { image: 'Photo de l’utilisateur', video: 'Vidéo de l’utilisateur', audio: 'Audio de l’utilisateur' }

function InputCard({ input: i, inputs, token, onChange, onPatch, upload, uploading, locked }) {
  const modes = i.slot === 'start' || i.slot === 'end' ? ['fixed', 'user', 'generated'] : ['fixed', 'user']
  const src = i.mode === 'generated' && i.from != null ? inputs.find((s) => s.idx === i.from) : null
  const set = (patch) => onChange(patchInput(inputs, i.idx, patch))
  const required = i.mode === 'user' ? !i.optional : true
  const title = inputTitle(i)
  return (
    <div className="tm-slot">
      {i.mode === 'fixed' ? (
        // La case de dépôt de l'éditeur (components/GenPanel.jsx), branchée sur l'envoi au serveur plutôt que sur la bibliothèque.
        <DropTile icon={KIND_ICON[i.kind] ?? 'img'} label={title} accept={i.slot === 'element' ? `${acceptFor('image')},${acceptFor('video')}` : acceptFor(i.kind)}
          asset={i.file ? pseudoAsset(i, title) : null} disabled={locked && !uploading} reason="Attendez la fin de l’envoi du fichier"
          onFile={(f) => { if (!f) onPatch(i.idx, { file: null, url: null }) }}
          upload={{
            busy: uploading,
            onFile: (f) => upload('input', f, `input-${i.idx}`, (r) => {
              // Un élément peut être une image ou une vidéo : la sorte suit le fichier déposé.
              const kind = i.slot === 'element' ? (f.type.startsWith('video/') ? 'video' : 'image') : i.kind
              onPatch(i.idx, { file: r.key, url: r.url, kind }) // sur l'état du moment ; numéros et modes sont bloqués pendant l'envoi
            }),
          }} />
      ) : <InputThumb input={i} />}
      <div className="tm-slot-b">
        <div className="tm-slot-t">
          <b>{title}</b>
          {token && <span className="tm-tok">{token}</span>}
          {i.mode === 'user' && <span className="tm-req">{required ? 'Obligatoire' : 'Facultative'}</span>}
        </div>
        <div className="tm-modes" role="radiogroup" aria-label={`Origine : ${title}`}>
          {modes.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={i.mode === m} className={i.mode === m ? 'on' : ''} disabled={locked && i.mode !== m} onClick={() => onChange(setMode(inputs, i.idx, m))}>{MODE_LABEL[m]}</button>
          ))}
        </div>
        {i.mode === 'fixed' && (
          <p className="tm-note tm-file">{i.file ? `Fournie par Qreativ, la même pour tous : ${i.file.split('/').pop()}. Touchez la case pour la remplacer.` : 'Touchez la case pour déposer le fichier, le même pour tous les utilisateurs.'}</p>
        )}
        {i.mode === 'user' && (
          <>
            <label className="adm-field">
              <span>Ce qu’on demande</span>
              <input value={i.label ?? ''} maxLength={LIMITS.label} onChange={(e) => set({ label: e.target.value })} placeholder="Ex. : Photo de votre produit, bien de face" />
            </label>
            <label className="adm-check"><input type="checkbox" checked={Boolean(i.optional)} onChange={(e) => set({ optional: e.target.checked })} />Facultatif pour l’utilisateur</label>
          </>
        )}
        {i.mode === 'generated' && (
          <>
            <label className="adm-field">
              <span>Consigne Krea 3</span>
              <textarea value={i.prompt ?? ''} maxLength={LIMITS.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="Ex. : le produit de l’utilisateur posé sur un comptoir bleu, lumière de studio" />
            </label>
            <label className="adm-check">
              <input type="checkbox" checked={i.from != null} disabled={locked} onChange={(e) => onChange(toggleSource(inputs, i.idx, e.target.checked))} />
              À partir d’une photo de l’utilisateur
            </label>
            {src && (
              <label className="adm-field">
                <span>Ce qu’on demande (photo de départ)</span>
                <input value={src.label ?? ''} maxLength={LIMITS.label} onChange={(e) => onChange(patchInput(inputs, src.idx, { label: e.target.value }))} placeholder="Ex. : Photo de votre bouteille" />
              </label>
            )}
          </>
        )}
      </div>
      <button type="button" className="tm-icon" aria-label={`Retirer : ${title}${token ? ` ${token}` : ''}`} disabled={locked} title={locked ? 'Attendez la fin de l’envoi du fichier' : undefined} onClick={() => onChange(removeInput(inputs, i.idx))}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

/** Vignette d'une entrée : le fichier fixe, un cadre pointillé pour ce que fournit l'utilisateur, une tuile Krea pour une image créée. */
export function InputThumb({ input: i }) {
  if (i.mode === 'generated') return <span className="tm-media gen" aria-hidden="true">Krea 3</span>
  if (i.mode === 'user') return <span className="tm-media ask" aria-hidden="true">{ASK[i.kind]}</span>
  if (!i.url) return <span className="tm-media ask" aria-hidden="true">Fichier à déposer</span>
  if (i.kind === 'image') return <span className="tm-media"><img src={i.url} alt="" loading="lazy" /></span>
  if (i.kind === 'video') return <span className="tm-media"><video src={`${i.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" /></span>
  return <span className="tm-media audio" aria-hidden="true"><Icon name="music" size={20} /></span>
}
