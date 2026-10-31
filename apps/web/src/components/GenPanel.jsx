import { useEffect, useRef, useState } from 'react'
import Icon from '../lib/icons.jsx'
import Menu from './Menu.jsx'
import { jetons, useJobs } from '../lib/jobs.jsx'
import { CAMERA_MOTIONS, videoCost } from '@studio/catalog'
import { useAssets } from '../lib/assets.jsx'
import AssetModal from './cinema/AssetModal.jsx'
import AssetThumb from './AssetThumb.jsx'
import { useToast } from '../lib/toasts.jsx'
import { api, apiEnabled } from '../lib/api.js'
import MentionTextarea from './MentionTextarea.jsx'
import PlanTabs from './PlanTabs.jsx'
import { ROLE_LABEL, resolveMentions, tokenFor, tokensIn } from '../lib/mentions.js'
import { KINDS } from '../lib/assets.jsx'
import { useBrand } from '../lib/brand.jsx'
import { DURATIONS, QUALITY, MODES, next } from '../lib/useGenSettings.js'
import '../styles/edit-panel.css'
import Cauri from './Cauri.jsx'

/** Section à intitulé en petites capitales. */
export function Section({ id, title, children }) {
  return (
    <section className="ep-sec" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  )
}

/** Liste « Standard / Brouillon ». */
export function QualityMenu({ s }) {
  return (
    <Menu items={QUALITY} value={s.quality} onChange={s.setQuality} label="Qualité" heading="Modes" menuWidth={290}>
      <span>{QUALITY.find((q) => q.id === s.quality).title}</span>
    </Menu>
  )
}

/**
 * Case d'entrée : ouvre la bibliothèque (choisir un fichier ou en importer un), avec l'aperçu d'une image une fois remplie.
 * `accept` limite ce que la bibliothèque montre et importe ; `disabled` + `reason` : le modèle choisi n'accepte pas cette entrée ;
 * `required` : il l'exige. `onFile(file, asset)` reçoit le fichier choisi (null pour vider la case). `asset` : la case montre cet
 * asset de la bibliothèque au lieu d'un fichier (les modèles gardent l'asset, pas le fichier).
 */
export function DropTile({ icon, label, accept, file, asset = null, onFile, disabled = false, reason, required = false }) {
  const [thumb, setThumb] = useState(null)
  const [picking, setPicking] = useState(false)
  const { getFile } = useAssets()
  const toast = useToast()
  useEffect(() => {
    if (!file || !file.type.startsWith('image')) return setThumb(null)
    const url = URL.createObjectURL(file)
    setThumb(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  if (disabled) {
    return (
      <div className="ep-tile off" title={reason} aria-disabled="true">
        <Icon name="lock" size={18} />
        <span>{label}</span>
        <span className="sr-only">{reason}</span>
      </div>
    )
  }
  const pick = async ([a]) => {
    try { onFile(await getFile(a), a) } catch { toast('Fichier introuvable : réimportez-le.') }
  }
  const name = file?.name ?? asset?.name
  const shown = !file && asset // un asset sans fichier : son aperçu de bibliothèque
  return (
    <>
      <div className={`ep-tile${name ? ' has' : ''}${thumb || shown ? ' pic' : ''}`} style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
        {shown && <AssetThumb asset={asset} />}
        <button type="button" className="ep-pick" aria-haspopup="dialog" aria-label={name ? `${label} : ${name}, changer` : `${label} : choisir dans la bibliothèque`} onClick={() => setPicking(true)} />
        <Icon name={icon} size={20} />
        <span>{name ?? label}</span>
        {required && !name && <em className="ep-req">requis</em>}
        {name && (
          <button type="button" className="ep-x" aria-label={`Retirer ${name}`} onClick={() => onFile(null)}>
            <Icon name="close" size={12} />
          </button>
        )}
        <span className="ep-lib" aria-hidden="true"><Icon name="folder" size={14} /></span>
      </div>
      <AssetModal open={picking} onClose={() => setPicking(false)} onAdd={pick} accept={accept} single />
    </>
  )
}

/**
 * Ligne « Ajouter un média » : ouvre la bibliothèque pour choisir plusieurs fichiers d'un coup. `onAdd(assets)` les reçoit
 * (Cinéma les cite dans le plan, voir pages/video/CreateTab.jsx) ; `accept` limite les types proposés. `style` / `onStyle` ajoutent
 * l'onglet Styles à la fenêtre (voir AssetModal).
 */
export function AddMedia({ label = 'Ajouter un média', onAdd, accept = 'image/*,video/*,audio/*', style, onStyle }) {
  const [picking, setPicking] = useState(false)
  return (
    <>
      <button type="button" className="ep-add" aria-haspopup="dialog" onClick={() => setPicking(true)}>
        <span className="ep-chips" aria-hidden="true">
          {['img', 'vid', 'mus', 'user', 'shapes', 'palette', 'plus'].map((n) => <i key={n}><Icon name={n} size={14} /></i>)}
        </span>
        <span>{label}</span>
      </button>
      <AssetModal open={picking} onClose={() => setPicking(false)} onAdd={(assets) => onAdd?.(assets)} accept={accept} style={style} onStyle={onStyle} />
    </>
  )
}

/**
 * Case d'une référence jointe (Cinéma) : son aperçu et son nom (« Image 1 »). Toucher la case la cite dans le texte ;
 * `off` : le modèle choisi ne l'utilise pas.
 */
export function RefTile({ asset, token, off = false, onCite, onRemove }) {
  return (
    <div className={`ep-tile has pic${off ? ' unused' : ''}`} title={off ? `${token} : non utilisé par ce modèle` : undefined}>
      <AssetThumb asset={asset} />
      <button type="button" className="ep-pick" aria-label={`Citer ${token} (${asset.name}) dans le texte`} onClick={onCite} />
      <Icon name={asset.kind === 'video' ? 'vid' : asset.kind === 'audio' ? 'mus' : 'img'} size={20} />
      <span>{token}</span>
      <button type="button" className="ep-x" aria-label={`Retirer ${token}`} onClick={onRemove}><Icon name="close" size={12} /></button>
    </div>
  )
}

const ENHANCE_ERRORS = {
  daily_limit: (e) => `Limite du jour atteinte : ${e.body.max} améliorations. Revenez demain.`,
  moderation: () => 'Ce texte ne peut pas être amélioré.',
  invalid_text: () => 'Écrivez d’abord quelques mots.',
  not_enhanceable: () => 'Ce modèle ne génère qu’un seul plan : choisissez Kling 3.0 pour découper une idée.',
}

/**
 * Bouton étincelle « Améliorer » : réécrit le texte pour le modèle choisi (voir apps/api/src/enhance.js), écrit le script d'une
 * voix off à partir de l'idée tapée (`kind: 'voice'`, dans `language`), ou précise le texte d'un champ de la page Modèles
 * (`kind: 'template'`, `workflowId` et `field`), ou découpe l'idée en plans (`kind: 'shots'`, `modelId` multi-plans) : la réponse
 * va alors à `onPlans(plans)`, qui rend de quoi l'annuler. Annuler dans le message de confirmation.
 * `enhance` : { value, onChange, onPlans, kind, …ce que l'API attend pour ce kind }. Absent sans l'API (moteur simulé).
 */
export function EnhanceButton({ value, onChange, onPlans, kind, ...spec }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const current = useRef(value) // le texte au retour de l'appel : une saisie faite entre-temps n'est pas écrasée
  current.current = value
  if (!apiEnabled) return null
  const short = value.trim().length < 3
  const voice = kind === 'voice'
  const label = voice ? 'Écrire le script à partir de cette idée' : kind === 'shots' ? 'Découper cette idée en plans' : 'Améliorer le texte'
  const run = async () => {
    const before = value
    setBusy(true)
    try {
      const { text, plans } = await api.enhance({ text: before, kind, ...spec })
      if (current.current !== before) return toast('Le texte a changé pendant l’amélioration : il est gardé tel quel.')
      if (plans) return toast(`Idée découpée en ${plans.length} plans.`, { label: 'Annuler', onClick: onPlans(plans) })
      onChange(text)
      toast(voice ? 'Script écrit.' : 'Texte amélioré.', { label: 'Annuler', onClick: () => { if (current.current === text) onChange(before) } })
    } catch (e) {
      toast(ENHANCE_ERRORS[e.body?.error]?.(e) ?? 'Amélioration indisponible : réessayez dans un instant.')
    } finally { setBusy(false) }
  }
  return (
    <button type="button" className="ep-ai" aria-label={label} title={short ? 'Écrivez d’abord quelques mots' : label} aria-busy={busy} disabled={busy || short} onClick={run}>
      <Icon name="sparkle" size={16} />
    </button>
  )
}

/**
 * Le cadre de texte de tous les panneaux (celui du Générateur de vidéos) : la zone de saisie, une note éventuelle, puis le pied
 * avec `foot` à gauche (@, puces), le bouton Améliorer si `enhance` est donné (voir EnhanceButton) et Effacer à droite.
 */
export function PromptBox({ children, note = null, foot = null, enhance = null, canClear, onClear, clearLabel = 'Effacer le texte', ...rest }) {
  return (
    <div className="ep-prompt" {...rest}>
      {children}
      {note}
      <div className="ep-pfoot">
        {foot}
        {enhance && <EnhanceButton {...enhance} />}
        <button type="button" className="ep-clear" aria-label={clearLabel} disabled={!canClear} onClick={onClear}><Icon name="close" size={14} /></button>
      </div>
    </div>
  )
}

/** Cite des assets dans le plan actif (« @mot-clé » en fin de texte), comme s'ils avaient été choisis avec @. */
export function citeAssets(s, assets) {
  const refs = { ...s.refs }
  const tokens = assets.map((a) => {
    const t = tokenFor(a, refs)
    refs[t] = a.id
    s.addRef(t, a.id)
    return `@${t}`
  })
  const text = s.current.text.trimEnd()
  s.patch(s.active, { text: `${text}${text ? ' ' : ''}${tokens.join(' ')} ` })
}

/**
 * Plans (onglets numérotés) et zone d'instruction. `modeItems` remplace le menu Manuel / Auto

 * (par ex. la direction d'une extension) ; `hint` est le texte d'aide du plan unique.
 * `mentions` ({ files }) active les références « @asset » dans le texte ; `files` : les fichiers déjà posés dans les cases du panneau.
 */
export function PlanSection({ s, hint, modeItems = MODES, modeLabel = 'Mode de découpage', modeValue, onMode, single = false, singleReason, mentions = null }) {
  const area = useRef(null)
  const { assets } = useAssets()
  const resolved = mentions && s.caps ? resolveMentions({ plans: s.plans, refs: s.refs, assets, caps: s.caps, files: mentions.files }) : null
  // Les assets de la bibliothèque proposés par « @ », chacun avec son mot-clé (nom sans espaces ni accents)
  const libraryItems = mentions ? assets.map((a) => { const token = tokenFor(a, s.refs); return { key: a.id, token, label: a.name, sub: `${KINDS[a.kind]} · @${token}`, asset: a } }) : []
  const roles = resolved ? Object.fromEntries(resolved.mentions.map((m) => [m.token, m.role])) : {}
  const unused = resolved ? tokensIn(s.current.text, s.refs).filter((t) => roles[t] === 'unused') : [] // cités dans ce plan mais inutilisables par le modèle
  const value = modeValue ?? s.mode
  // Mode Auto sur un modèle multi-plans : l'étincelle découpe l'idée du plan affiché en plans (instruction et durée chacun).
  const split = !modeValue && s.mode === 'auto' && s.caps?.multiShot
  const idea = split && !s.multi ? 'Décrivez toute votre idée : l’étincelle la découpe en plans.' : hint
  const onPlans = (ps) => { s.replacePlans(ps); const before = s.plans; return () => s.replacePlans(before, ps) }
  const insertAt = () => (mentions ? area.current?.insertAt() : (s.patch(s.active, { text: `${s.current.text}@` }), area.current?.focus()))
  return (
    <section className="ep-sec" aria-labelledby="ep-plan">
      <div className="ep-row">
        <PlanTabs s={s} single={single} singleReason={singleReason} />
        <Menu items={modeItems} value={value} onChange={onMode ?? s.setMode} label={modeLabel} menuWidth={260} className="ep-mode">
          <span>{modeItems.find((m) => m.id === value).title}</span>
        </Menu>
      </div>
      <PromptBox
        role={s.multi ? 'tabpanel' : undefined} id="plan-panel" aria-labelledby={s.multi ? `plan-tab-${s.active}` : undefined}
        canClear={Boolean(s.current.text)} onClear={() => s.patch(s.active, { text: '' })} clearLabel="Effacer l’instruction"
        enhance={{ value: s.current.text, onChange: (text) => s.patch(s.active, { text }), onPlans, kind: split ? 'shots' : 'video', modelId: s.modelId }}
        note={unused.length > 0 && <p className="ep-refnote">{unused.map((t) => `@${t}`).join(', ')} : {ROLE_LABEL.unused.toLowerCase()}.</p>}
        foot={<>
          <button type="button" className="ep-at" aria-label="Insérer une référence" onClick={insertAt}><Icon name="at" size={16} /></button>
          {s.caps?.cameraMotion && (
            <Menu items={CAMERA_MOTIONS} value={s.camera} onChange={s.setCamera} label="Mouvement de caméra" menuWidth={230} className="ep-chip ep-cam">
              <Icon name="motion" size={16} />{CAMERA_MOTIONS.find((c) => c.id === s.camera).title.replace('Caméra : auto', 'Caméra')}
            </Menu>
          )}
          {s.multi && (
            <button type="button" className="ep-chip" aria-label={`Durée du plan ${s.active + 1} : ${s.current.dur} secondes`} onClick={() => s.patch(s.active, { dur: next(DURATIONS, s.current.dur) })}>
              <Icon name="clock" size={16} />{s.current.dur} s
            </button>
          )}
        </>}
      >
        {mentions ? (
          <MentionTextarea
            ref={area}
            value={s.current.text}
            onChange={(text) => s.patch(s.active, { text })}
            items={libraryItems}
            isRef={(t) => Boolean(s.refs[t])}
            roles={roles}
            onPick={(it) => s.addRef(it.token, it.asset.id)}
            emptyHint="La bibliothèque est vide : générez ou importez un fichier."
            placeholder={s.multi ? `Décrivez le plan ${s.active + 1} : qui y figure, ce qu’il fait, le mouvement de caméra… Tapez @ pour citer un asset.` : `${idea} Tapez @ pour citer un asset.`}
            aria-label={s.multi ? `Instruction du plan ${s.active + 1}` : 'Instruction'}
            rows={4}
            data-prompt
          />
        ) : (
          <textarea
            ref={area}
            value={s.current.text}
            onChange={(e) => s.patch(s.active, { text: e.target.value })}
            placeholder={s.multi ? `Décrivez le plan ${s.active + 1} : qui y figure, ce qu’il fait, le mouvement de caméra…` : idea}
            aria-label={s.multi ? `Instruction du plan ${s.active + 1}` : 'Instruction'}
            rows={4}
            data-prompt
          />
        )}
      </PromptBox>
    </section>
  )
}

/** Résolution, durée (totale si plusieurs plans), format, son : chaque puce suit ce que le modèle accepte. */
export function OptionChips({ s, fixedSecs = null }) {
  const fixed = fixedSecs !== null
  const durationLabel = `Durée ${s.multi ? 'totale' : ''} : ${s.total} secondes`
  const sound = s.soundMode === 'always' ? { text: 'ON', off: true, why: 'Ce modèle génère toujours une piste sonore' }
    : s.soundMode === 'provided' ? { text: 'Audio', off: true, why: 'La piste sonore est celle que vous fournissez' }
      : { text: s.sound ? 'ON' : 'OFF', off: false }
  return (
    <div className={`ep-opts${s.caps?.fps ? ' five' : ''}`}>
      {s.resolutions ? (
        <button type="button" className="ep-chip" disabled={s.draft} title="Résolution" aria-label={`Résolution : ${s.draft ? '480p' : s.res}`} onClick={() => s.setRes(next(s.resolutions, s.res))}>
          <Icon name="upscale" size={16} />{s.draft ? '480p' : s.res}
        </button>
      ) : (
        <button type="button" className="ep-chip" disabled title="Ce modèle ne propose pas de réglage de résolution" aria-label="Résolution : non réglable pour ce modèle">
          <Icon name="upscale" size={16} />Auto
        </button>
      )}
      <button
        type="button"
        className="ep-chip"
        disabled={s.multi || s.fromAudio || fixed}
        title={fixed ? 'La durée suit la vidéo source' : (s.fromAudio ? `La durée est celle de votre audio (${s.caps?.duration?.fromAudio?.min ?? 2} à ${s.caps?.duration?.fromAudio?.max ?? 10} s)` : 'Durée')}
        aria-label={fixed ? `Durée : celle de la vidéo source${fixedSecs ? `, ${fixedSecs} secondes` : ''}` : (s.fromAudio ? `Durée : celle de l’audio${s.total ? `, ${s.total} secondes` : ''}` : durationLabel)}
        onClick={() => s.patch(0, { dur: next(s.picks, s.plans[0].dur) })}
      >
        <Icon name="clock" size={16} />{fixed ? (fixedSecs ? `${String(fixedSecs).replace('.', ',')} s` : '— s') : (s.fromAudio && !s.total ? '— s' : `${String(s.total).replace('.', ',')} s`)}
      </button>
      {s.ratios ? (
        <button type="button" className="ep-chip" aria-label={`Format : ${s.ratio === 'auto' ? 'suit l’image de départ' : s.ratio}`} title={s.ratio === 'auto' ? 'Format : suit l’image de départ' : 'Format'} onClick={() => s.setRatio(next(s.ratios, s.ratio))}>
          <Icon name="screen" size={16} />{s.ratio === 'auto' ? 'Auto' : s.ratio}
        </button>
      ) : (
        <button type="button" className="ep-chip" disabled title="Le format suit l’image de départ (16:9 en texte seul)" aria-label="Format : suit l’image de départ">
          <Icon name="screen" size={16} />Auto
        </button>
      )}
      {s.caps?.fps && (
        <button type="button" className="ep-chip" title="Images par seconde" aria-label={`Images par seconde : ${s.fps}`} onClick={() => s.setFps(next(s.caps.fps, s.fps))}>
          <Icon name="gauge" size={16} />{s.fps} i/s
        </button>
      )}
      <button type="button" className="ep-chip" disabled={sound.off} title={sound.why} aria-pressed={s.sound} aria-label="Son" onClick={() => s.setSound((v) => !v)}>
        <Icon name="sound" size={16} />{sound.text}
      </button>
    </div>
  )
}

export function GenerateButton({ price, disabled, error, title, onClick }) {
  return (
    <div className="ep-gen">
      {error && <p className="ep-gerr" role="alert">{error}</p>}
      <button type="button" className="gen" disabled={disabled} title={title} onClick={onClick}>
        Générer<span><Cauri size={18} />{jetons(price)}</span>
      </button>
    </div>
  )
}

/**
 * Bouton Générer collé en bas du panneau défilant : soumet une génération vidéo et affiche le coût en jetons.
 * `blocker` : raison pour laquelle le modèle choisi ne peut pas encore générer (ex. image de départ requise).
 */
export function GenerateBar({ s, title, meta, blocker, cost = s.cost, needsText = true, secs = s.total, brand = false, live = null }) {
  const { submit } = useJobs()
  const { brand: kit, style } = useBrand()
  const styled = brand && kit.apply && Boolean(style) // style visuel de la marque, ajouté à la description
  const [error, setError] = useState('')
  const { assets, getFile } = useAssets()
  // Modèle à références (Seedance) : les vidéos citées sont facturées en entrée, le prix affiché en tient compte.
  const preview = live?.model?.caps?.references ? resolveMentions({ plans: s.plans, refs: s.refs, assets, caps: live.model.caps, files: live.files }) : null
  const sourceSecs = live?.sourceSecs ?? 0
  const inputSecs = (preview ? preview.references.filter((r) => r.kind === 'video').reduce((n, r) => n + (r.asset.secs || 0), 0) : 0) + sourceSecs
  const price = (preview && live?.model) ? videoCost(live.model, secs, s.resolutions ? s.res : undefined, { inputSecs, sound: s.sound }) : cost
  const onClick = async () => {
    const prompt = s.plans.map((p) => p.text.trim()).filter(Boolean).join(' / ')
    const base = meta ?? `${s.total} s · ${s.ratio} · ${s.draft ? '480p' : s.res}`
    // Demande réelle : le modèle choisi, les options retenues et les fichiers d'entrée que ce modèle accepte.
    const c = live?.model?.caps
    // Assets cités par « @ » : ce que le modèle peut en faire (image de départ, élément…) et leurs fichiers.
    const ref = (live && c) ? resolveMentions({ plans: s.plans, refs: s.refs, assets, caps: c, files: live.files }) : null
    let extra = {}
    if (ref) {
      try {
        const get = (a) => (a ? getFile(a) : null)
        const [start, end, audio] = await Promise.all([get(ref.slots.start), get(ref.slots.end), get(ref.slots.audio)])
        const elements = await Promise.all(ref.elements.map(async (a) => ({ kind: a.kind, file: await getFile(a) })))
        const references = await Promise.all(ref.references.map(async (r) => ({ kind: r.kind, file: await getFile(r.asset) })))
        extra = { start, end, audio, elements, references }
      } catch {
        setError('Un asset cité est introuvable : réimportez-le ou retirez la référence.')
        return
      }
    }
    const references = [...(live?.source ? [{ kind: 'video', file: live.source }] : []), ...(extra.references ?? [])]
    const liveSpec = live && {
      kind: 'video', modelId: live.model?.id, plans: s.plans.map(({ dur }, i) => ({ text: ref ? ref.texts[i] : s.plans[i].text, dur })), secs: Math.round(secs * 10) / 10,
      resolution: s.resolutions ? s.res : undefined, ratio: s.ratios ? s.ratio : undefined, fps: c?.fps ? s.fps : undefined, sound: s.sound, camera: s.camera,
      brandStyle: styled ? style : undefined,
      files: c ? { start: c.startFrame !== 'none' ? (live.files?.start ?? extra.start) : null, end: c.endFrame ? (live.files?.end ?? extra.end) : null, audio: c.audioRef ? (live.files?.audio ?? extra.audio) : null } : (live.files ?? {}),
      elements: extra.elements?.length ? extra.elements : undefined,
      references: references.length ? references : undefined,
      task: live?.task,
      inputSecs: inputSecs || undefined,
    }
    const r = submit({ kind: 'video', title, prompt, cost: price, secs, brandStyle: styled ? style : undefined, live: liveSpec, meta: styled ? `${base} · style de la marque` : base })
    setError(r.ok ? '' : `Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
  }
  return (
    <GenerateButton price={price} error={error} title={blocker ?? undefined} disabled={(needsText && !s.ready) || Boolean(blocker)} onClick={onClick} />
  )
}
