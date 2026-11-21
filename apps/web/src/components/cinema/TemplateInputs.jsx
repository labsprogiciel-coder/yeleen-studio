import { DropTile, PromptBox } from '../GenPanel.jsx'
import AssetThumb from '../AssetThumb.jsx'
import MentionTextarea from '../MentionTextarea.jsx'
import Icon from '../../lib/icons.jsx'
import { jetons } from '../../lib/jobs.jsx'
import { acceptFor, canGenerate, inputTitle, inputTokens } from '../../lib/templateRun.js'
import './templateInputs.css'

const ICON = { image: 'img', video: 'vid', audio: 'mus' }

/** Fichier fourni par Qreativ : son aperçu, en lecture seule. */
function FixedTile({ input, title }) {
  return (
    <div className="ep-tile has pic ti-fixed" title={`${title} : fourni par Qreativ`}>
      {input.url && input.kind === 'image' && <img className="ti-media" src={input.url} alt="" loading="lazy" />}
      {input.url && input.kind === 'video' && <video className="ti-media" src={`${input.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" />}
      <Icon name={ICON[input.kind]} size={20} />
      <span>{title}</span>
      <em className="ti-by">Fourni par Qreativ</em>
    </div>
  )
}

/** Image créée par Krea 3 : vide (à créer, ou en cours), ou l'image prête, que × retire pour en créer une autre. */
function MadeTile({ title, asset, busy, onClear }) {
  if (!asset) {
    return (
      <div className="ep-tile ti-gen" aria-busy={busy || undefined}>
        <Icon name="sparkle" size={20} />
        <span>{title}</span>
        <em className="ti-by">{busy ? 'Création…' : 'À créer avec Krea 3'}</em>
      </div>
    )
  }
  return (
    <div className="ep-tile has pic">
      <AssetThumb asset={asset} />
      <Icon name="img" size={20} />
      <span>{title}</span>
      <button type="button" className="ep-x" aria-label={`Retirer l’${title.charAt(0).toLowerCase()}${title.slice(1)} pour en créer une autre`} onClick={onClear}><Icon name="close" size={12} /></button>
    </div>
  )
}

/**
 * Entrées d'une vidéo à refaire dans Références (Cinéma), une case par entrée dans l'ordre : à fournir (choisie dans la bibliothèque,
 * avec son libellé, son mot-clé et « facultatif »), fournie par Qreativ (lecture seule), ou créée d'abord par Krea 3 (sa consigne
 * modifiable et « Créer l'image », possible une fois la photo de départ ajoutée ; l'image prête remplit la case).
 * `given` : { [idx]: asset } ; `onGiven(idx, asset | null)`. `prompts` / `onPrompt(idx, texte)` : consignes Krea ; `busy` : { [idx]: vrai }
 * pendant la création ; `costs` : { [idx]: cauris } ; `onMake(idx)` lance la création. `onCite(token)` cite le mot-clé dans le plan.
 */
export default function TemplateInputs({ inputs, given, onGiven, prompts, onPrompt, busy, costs, onMake, onCite }) {
  const tokens = inputTokens(inputs)
  const generated = inputs.filter((i) => i.mode === 'generated')
  return (
    <>
      <div className="ep-tiles ti-tiles">
        {inputs.map((i) => {
          const title = inputTitle(i, inputs)
          const tok = tokens[i.idx]
          let tile
          if (i.mode === 'fixed') tile = <FixedTile input={i} title={title} />
          else if (i.mode === 'generated') tile = <MadeTile title={title} asset={given[i.idx] ?? null} busy={Boolean(busy[i.idx])} onClear={() => onGiven(i.idx, null)} />
          else tile = <DropTile icon={ICON[i.kind]} label={title} accept={acceptFor(i)} file={null} asset={given[i.idx] ?? null} onFile={(f, a) => onGiven(i.idx, f ? a ?? null : null)} required={!i.optional} />
          const g = i.slot === 'source' && inputs.find((x) => x.mode === 'generated' && x.from === i.idx)
          return (
            <div key={i.idx} className="ep-tile-wrap ti-wrap">
              {tile}
              <span className="ti-tags">
                {tok && <button type="button" className="ti-tok" title={`Citer ${tok} dans le plan`} onClick={() => onCite?.(tok.slice(1))}>{tok}</button>}
                {i.mode === 'user' && i.optional && <em className="ti-opt">facultatif</em>}
                {g && <em className="ti-opt">pour l’{g.slot === 'end' ? 'image de fin' : 'image de début'}</em>}
              </span>
            </div>
          )
        })}
      </div>
      {generated.map((i) => {
        const title = inputTitle(i, inputs)
        const src = i.from != null ? inputs.find((x) => x.idx === i.from) : null
        const text = prompts[i.idx] ?? ''
        const made = Boolean(given[i.idx])
        const ready = canGenerate(i, given, text)
        const what = i.slot === 'end' ? 'l’image de fin' : 'l’image de début'
        return (
          <div key={i.idx} className="ti-krea">
            <h3 id={`ti-k-${i.idx}`}>{title} · Krea 3</h3>
            <p className="tf-hint">
              {src
                ? `Krea 3 crée ${what} à partir de ${given[src.idx] ? 'votre photo' : `${inputTitle(src, inputs).charAt(0).toLowerCase()}${inputTitle(src, inputs).slice(1)} (à ajouter ci-dessus)`} ; la vidéo l’utilise ensuite.`
                : `Krea 3 crée ${what} ; la vidéo l’utilise ensuite.`}
            </p>
            <PromptBox canClear={Boolean(text)} onClear={() => onPrompt(i.idx, '')} clearLabel={`Effacer la consigne de ${what}`}
              enhance={{ value: text, onChange: (v) => onPrompt(i.idx, v), kind: src ? 'edit' : 'image', modelId: 'krea-3' }}>
              <MentionTextarea mentions={false} value={text} onChange={(v) => onPrompt(i.idx, v)} aria-labelledby={`ti-k-${i.idx}`} rows={3} />
            </PromptBox>
            <button type="button" className="ep-chip ep-start" disabled={Boolean(busy[i.idx]) || !ready} onClick={() => onMake(i.idx)}
              title={!ready && src && !given[src.idx] ? `Ajoutez d’abord : ${inputTitle(src, inputs).charAt(0).toLowerCase()}${inputTitle(src, inputs).slice(1)}` : undefined}>
              <Icon name="sparkle" size={16} />
              {busy[i.idx] ? 'Création de l’image…' : `${made ? 'Recréer' : 'Créer'} ${what}`}
              <span className="ep-price">{jetons(costs[i.idx] ?? 0)} cauris</span>
            </button>
          </div>
        )
      })}
    </>
  )
}
