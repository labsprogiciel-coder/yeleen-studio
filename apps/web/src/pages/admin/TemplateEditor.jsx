import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useLeaveGuard from './useLeaveGuard.js'
import { VIDEO_MODELS } from '@studio/catalog'
import { findTool } from '@studio/catalog/tools'
import { findVideoModel } from '@studio/catalog/template-slots'
import Icon from '../../lib/icons.jsx'
import Menu from '../../components/Menu.jsx'
import ModelLogo from '../../components/ModelLogo.jsx'
import { logoFor } from '../../lib/modelLogos.js'
import { api } from '../../lib/api.js'
import { caurisLabel, cauris } from '../../lib/admin.js'
import { categoryLabel } from '../../lib/templates.js'
import {
  ACCEPT, BLURB_MAX, CATEGORIES, GENJUTSU_LIMITS, GENJUTSU_RATIOS, GENJUTSU_TOOLS, NAME_MAX, capChips, draftIssues, durationsFor, framesRefsWarning, fromTemplate, planTabsState, pseudoAsset,
  draftAfterSave, isCategory, isDirty, issueText, patchInput, soundChoice, templateError, templatePrice, toPayload, userNeeds,
} from '../../lib/adminTemplates.js'
import PlanTabs from '../../components/PlanTabs.jsx'
import MentionTextarea from '../../components/MentionTextarea.jsx'
import { PromptBox, RefTile } from '../../components/GenPanel.jsx'
import { MAX_PLANS } from '../../lib/useGenSettings.js'
import { TOKEN_PATTERN, tokenItems } from '../../lib/templateRun.js'
import '../../styles/library.css' // aperçus AssetThumb (.at) des cases reprises du panneau de l'éditeur
import TemplateInputs from './TemplateInputs.jsx'
import Switch from './Switch.jsx'

const mo = (bytes) => `${(bytes / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
const fileName = (key) => (key ? key.split('/').pop() : '')

/**
 * Éditeur d'un modèle (vidéo à refaire) : présentation, fabrication (générateur vidéo ou Genjutsu), entrées, plans ; à droite,
 * l'aperçu, ce que l'utilisateur fournit, le prix et la publication. Rien n'est enregistré avant « Enregistrer », sauf les fichiers
 * déposés (rangés tout de suite sous templates/<id>/, et rattachés au modèle à l'enregistrement).
 */
const LEAVE = 'Quitter sans enregistrer les changements ?'

/** Modèles vidéo proposés dans l'éditeur : logo et nom. */
const MODEL_ITEMS = VIDEO_MODELS.map((m) => ({ id: m.id, logo: logoFor(m.id), icon: 'video', title: m.name }))

export default function TemplateEditor({ id, onBack }) {
  const [t, setT] = useState(null) // le modèle tel que l'API l'a renvoyé
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState(null) // { ok?, message, issues? }
  const [uploading, setUploading] = useState({}) // envois en cours : { [emplacement]: true }
  const [uploadErr, setUploadErr] = useState(null)
  const [videoInfo, setVideoInfo] = useState(null) // { name, size } du dernier dépôt de la vidéo d'exemple
  const [sourceInfo, setSourceInfo] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const apply = (tpl) => { const d = fromTemplate(tpl); setT(tpl); setSaved(d); setDraft(d) }
  const load = () => {
    setLoadErr(null)
    api.adminTemplate(id).then((r) => apply(r.template)).catch((e) => setLoadErr(templateError(e).message))
  }
  useEffect(load, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = Boolean(draft && saved && isDirty(draft, saved))
  // Quitter la page avec des changements non enregistrés (rechargement, liens de l'application, Précédent) : confirmation demandée.
  useLeaveGuard(dirty, LEAVE)

  if (loadErr) {
    return (
      <div className="adm-card">
        <p className="adm-err" role="alert">{loadErr}</p>
        <div className="adm-actions"><button type="button" className="adm-btn" onClick={onBack}>← Modèles</button><button type="button" className="adm-btn" onClick={load}>Réessayer</button></div>
      </div>
    )
  }
  if (!draft) return <p className="adm-note" aria-live="polite">Chargement…</p>

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setG = (patch) => setDraft((d) => ({ ...d, genjutsu: { ...d.genjutsu, ...patch } }))
  const back = () => { if (!dirty || window.confirm(LEAVE)) onBack() }
  const gen = draft.kind === 'generator'
  const model = gen ? findVideoModel(draft.modelId) : null
  const issues = draftIssues(draft)
  const price = templatePrice({ ...draft, genjutsu: gen ? null : draft.genjutsu })
  const shownInputs = gen ? draft.inputs : []

  const upload = async (role, file, slot, done) => {
    setUploading((u) => ({ ...u, [slot]: true }))
    setUploadErr(null)
    try {
      const r = await api.adminUploadTemplateFile(id, file, role)
      done(r)
    } catch (e) {
      setUploadErr(`${file.name} : ${templateError(e).message}`)
    } finally { setUploading(({ [slot]: _, ...u }) => u) }
  }

  // Après un enregistrement : la réponse devient la référence ; le brouillon n'est remplacé que s'il n'a pas changé pendant l'envoi.
  const settle = (tpl, sent) => {
    const d = fromTemplate(tpl)
    setT(tpl)
    setSaved(d)
    setDraft((cur) => draftAfterSave(cur, sent, d))
  }

  const save = async () => {
    setSaving(true)
    setResult(null)
    try {
      const sent = draft
      const r = await api.adminSaveTemplate(id, toPayload(sent))
      if (r?.template) settle(r.template, sent)
      else api.adminTemplate(id).then((x) => settle(x.template, sent)).catch(() => {})
      setResult({ ok: true, message: 'Modifications enregistrées.' })
    } catch (e) {
      const err = templateError(e)
      setResult({ message: err.message, issues: err.issues.map((i) => issueText(i, shownInputs)) })
    } finally { setSaving(false) }
  }

  const publish = async (on) => {
    setPublishing(true)
    setResult(null)
    try {
      const r = await api.adminPublishTemplate(id, on)
      if (r?.template) { setT(r.template); } else setT((x) => ({ ...x, published: on }))
      setResult({ ok: true, message: on ? 'Publié : visible par tous dans Modèles.' : 'Retiré de Modèles : visible seulement ici.' })
    } catch (e) {
      const err = templateError(e)
      setResult({ message: err.message, issues: err.issues.map((i) => issueText(i, shownInputs)) })
    } finally { setPublishing(false) }
  }

  const changeModel = (modelId) => {
    const m = findVideoModel(modelId)
    setDraft((d) => ({
      ...d, modelId,
      resolution: m?.caps.resolutions?.includes(d.resolution) ? d.resolution : null,
      ratio: m?.caps.ratios?.includes(d.ratio) ? d.ratio : null,
    }))
  }

  return (
    <div className="tm-editor">
      <button type="button" className="tm-back" onClick={back}>← Modèles</button>
      <div className="tm-head">
        <h2>{draft.name || 'Sans nom'}</h2>
        <span className="tm-tag">{gen ? 'Générateur vidéo' : 'Genjutsu'}</span>
        <span className="sp">
          {t.published && <button type="button" className="adm-btn" onClick={() => publish(false)} disabled={publishing}>Retirer de Modèles</button>}
          <button type="button" className="adm-btn danger" onClick={() => setDeleting(true)}><Icon name="trash" size={16} />Supprimer définitivement</button>
        </span>
      </div>

      <div className="tm-edit">
        <div className="tm-col">
          {uploadErr && <p className="adm-err" role="alert">{uploadErr}</p>}

          <section className="adm-card tm-sec" aria-labelledby="tm-v-t">
            <h3 id="tm-v-t">Vidéo d’exemple</h3>
            <div className="tm-drop">
              <span className="tm-thumb">{draft.video ? <video src={`${draft.video}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" /> : <Icon name="play" size={18} />}</span>
              <div>
                <b>{videoInfo?.name ?? (fileName(draft.videoKey) || 'Aucune vidéo')}</b>
                {videoInfo && <span>{mo(videoInfo.size)}</span>}
                <span className="tm-note">Montrée dans Modèles. Déposez un fichier déjà léger (20 Mo au plus) : il n’est pas recompressé.</span>
              </div>
              <FileButton accept={ACCEPT.video} busy={Boolean(uploading.video)} label={draft.videoKey ? 'Remplacer' : 'Déposer'}
                onFile={(f) => upload('video', f, 'video', (r) => { set({ videoKey: r.key, video: r.url }); setVideoInfo({ name: f.name, size: r.size ?? f.size }) })} />
            </div>
          </section>

          <section className="adm-card tm-sec" aria-labelledby="tm-p-t">
            <h3 id="tm-p-t">Présentation</h3>
            <div className="tm-grid">
              <label className="adm-field"><span>Nom</span><input value={draft.name} maxLength={NAME_MAX} onChange={(e) => set({ name: e.target.value })} /></label>
              <CategoryField value={draft.category} onChange={(category) => set({ category })} />
            </div>
            <label className="adm-field">
              <span>Phrase au survol <small>({draft.blurb.length}/{BLURB_MAX})</small></span>
              <input value={draft.blurb} maxLength={BLURB_MAX} onChange={(e) => set({ blurb: e.target.value })} placeholder="Ex. : Ta bouteille surgit d’une vague de glaçons." />
            </label>
          </section>

          <section className="adm-card tm-sec" aria-labelledby="tm-m-t">
            <h3 id="tm-m-t">Modèle et réglages</h3>
            <div className="adm-seg tm-kind" role="radiogroup" aria-label="Fabrication">
              <button type="button" role="radio" aria-checked={gen} onClick={() => set({ kind: 'generator' })}>Générateur vidéo</button>
              <button type="button" role="radio" aria-checked={!gen} onClick={() => set({ kind: 'genjutsu' })}>Genjutsu</button>
            </div>
            {gen ? (
              <>
                <div className="tm-grid3">
                  <div className="adm-field">
                    <span id="tm-model-l">Modèle</span>
                    <Menu items={MODEL_ITEMS} value={draft.modelId} onChange={changeModel} label="Modèle vidéo" menuWidth={340} search="Rechercher un modèle" className="tm-model">
                      {model ? <><ModelLogo logo={logoFor(model.id)} size={18} /><span className="tm-model-n">{model.name}</span></>
                        : <span className="tm-model-n">Modèle retiré ({draft.modelId})</span>}
                    </Menu>
                  </div>
                  {model?.caps.resolutions && (
                    <label className="adm-field">
                      <span>Résolution</span>
                      <select value={draft.resolution ?? ''} onChange={(e) => set({ resolution: e.target.value || null })}>
                        <option value="">Par défaut ({model.caps.resolutions[0]})</option>
                        {model.caps.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                  )}
                  {model?.caps.ratios && (
                    <label className="adm-field">
                      <span>Format</span>
                      <select value={draft.ratio ?? ''} onChange={(e) => set({ ratio: e.target.value || null })}>
                        <option value="">Au choix de l’utilisateur</option>
                        {model.caps.ratios.map((r) => <option key={r} value={r}>{r === 'auto' ? 'Auto' : r}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                {model && (
                  <ul className="tm-caps" aria-label="Ce que le modèle accepte">
                    {capChips(model).map((c) => <li key={c.label} className={`tm-cap${c.off ? ' off' : ''}`}>{c.off && <span className="sr">Non : </span>}{c.label}</li>)}
                  </ul>
                )}
                {model && framesRefsWarning(model, draft.inputs) && (
                  <p className="tm-warn-box" role="note"><Icon name="alert" size={16} />{model.name} ne combine pas les images de début et de fin avec des références : retirez les unes ou les autres avant de publier.</p>
                )}
                {soundChoice(model) && (
                  <label className="adm-check"><input type="checkbox" checked={draft.sound} onChange={(e) => set({ sound: e.target.checked })} />Avec le son</label>
                )}
              </>
            ) : (
              <GenjutsuFields g={draft.genjutsu} setG={setG} ratio={draft.ratio} onRatio={(ratio) => set({ ratio })} uploading={Boolean(uploading.source)} sourceInfo={sourceInfo}
                onSource={(f) => upload('source', f, 'source', (r) => { setG({ sourceKey: r.key, source: r.url, ...(r.secs ? { secs: Math.round(r.secs * 10) / 10 } : {}) }); setSourceInfo({ name: f.name, size: r.size ?? f.size, measured: Boolean(r.secs) }) })} />
            )}
          </section>

          {gen && <TemplateInputs model={model} inputs={draft.inputs} onChange={(inputs) => set({ inputs })}
            onPatch={(idx, patch) => setDraft((d) => ({ ...d, inputs: patchInput(d.inputs, idx, patch) }))} upload={upload} uploading={uploading} />}
          {gen && <Plans model={model} plans={draft.plans} inputs={draft.inputs} onChange={(plans) => set({ plans })} />}
          {!gen && <Roles roles={draft.genjutsu.roles} onChange={(roles) => setG({ roles })} />}
        </div>

        <aside className="tm-side" aria-label="Aperçu et publication">
          <section className="adm-card tm-sec" aria-labelledby="tm-a-t">
            <h3 id="tm-a-t">Aperçu <small>comme dans Modèles</small></h3>
            <div className="tm-prev">
              {draft.video && <video src={draft.video} muted loop playsInline autoPlay preload="metadata" aria-hidden="true" />}
              <span className="pill">{categoryLabel(draft.category)}</span>
              <b>{draft.name || 'Sans nom'}</b>
              {draft.blurb && <small>{draft.blurb}</small>}
            </div>
          </section>

          <section className="adm-card tm-sec" aria-labelledby="tm-u-t">
            <h3 id="tm-u-t">Ce que l’utilisateur fournit</h3>
            <dl className="tm-kv">{userNeeds(draft).map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
          </section>

          <section className="adm-card tm-sec" aria-labelledby="tm-c-t">
            <h3 id="tm-c-t">Prix pour l’utilisateur</h3>
            {price ? (
              <>
                <p className="tm-big">{caurisLabel(price.total)}</p>
                <dl className="tm-kv">{price.lines.map((l) => <div key={l.label}><dt>{l.label}</dt><dd>{cauris(l.cost)}</dd></div>)}</dl>
                <p className="tm-note">Calculé avec le catalogue, comme à la génération : il suit les changements de prix.</p>
              </>
            ) : <p className="tm-note">— cauris : choisissez un modèle du catalogue et une durée.</p>}
          </section>

          <section className="adm-card tm-sec" aria-labelledby="tm-pub-t">
            <h3 id="tm-pub-t">Publication</h3>
            <Switch on={t.published} busy={publishing} disabled={dirty || (!t.published && issues.length > 0)} onToggle={() => publish(!t.published)} label={draft.name} />
            {dirty && <p className="tm-note">Enregistrez d’abord vos changements pour publier ou retirer le modèle.</p>}
            {issues.length > 0
              ? <ul className="tm-issues" aria-label="À corriger avant de publier">{issues.map((i, n) => <li key={n}>{issueText(i, shownInputs)}</li>)}</ul>
              : <p className="tm-note">Rien à corriger.</p>}
            <Link className="adm-btn" to={`/cinema?tpl=${encodeURIComponent(id)}`}>Essayer sur mon compte</Link>
            {dirty && <p className="tm-note">L’essai utilise la version enregistrée.</p>}
            <button type="button" className="adm-btn primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}</button>
            {result && (
              <div className={result.ok ? 'adm-ok' : 'adm-err'} role={result.ok ? 'status' : 'alert'}>
                <p>{result.message}</p>
                {result.issues?.length > 0 && <ul>{result.issues.map((m, n) => <li key={n}>{m}</li>)}</ul>}
              </div>
            )}
          </section>
        </aside>
      </div>
      {deleting && <DeleteDialog id={id} name={t.name} onClose={() => setDeleting(false)} onDeleted={onBack} />}
    </div>
  )
}

/** Bouton de dépôt d'un fichier (un champ fichier caché dans un libellé). */
function FileButton({ accept, busy, label, onFile }) {
  return (
    <label className={`adm-btn sm tm-up${busy ? ' busy' : ''}`}>
      <Icon name="upload" size={14} />{busy ? 'Envoi…' : label}
      <input type="file" className="sr" accept={accept} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
    </label>
  )
}

/** Catégorie : une connue dans la liste, ou une autre saisie librement (lettres minuscules, chiffres, tirets). */
function CategoryField({ value, onChange }) {
  const known = CATEGORIES.some(([c]) => c === value)
  const [free, setFree] = useState(!known)
  return (
    <div className="tm-catf">
      <label className="adm-field">
        <span>Catégorie</span>
        <select value={free ? '*' : value} onChange={(e) => { if (e.target.value === '*') setFree(true); else { setFree(false); onChange(e.target.value) } }}>
          {CATEGORIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          <option value="*">Autre…</option>
        </select>
      </label>
      {free && (
        <label className="adm-field">
          <span>Nouvelle catégorie</span>
          <input value={value} maxLength={30} onChange={(e) => onChange(e.target.value.toLowerCase().replace(/\s+/g, '-'))} aria-invalid={!isCategory(value)} placeholder="ex. : sport" />
          {!isCategory(value) && <small className="tm-warn">Lettres minuscules sans accent, chiffres et tirets (30 au plus).</small>}
        </label>
      )}
    </div>
  )
}

/**
 * Plans du générateur, avec les pièces du panneau de l'éditeur (comme l'écran Cinéma) : onglets numérotés (PlanTabs), cadre de
 * texte (PromptBox) où « @ » cite une entrée (MentionTextarea), durée du plan au pied ; les cases des entrées citables, au-dessus,
 * insèrent leur jeton au curseur. Le plan affiché reste un état d'écran : le brouillon ne change que par `onChange(plans)`.
 */
function Plans({ model, plans, inputs, onChange }) {
  const area = useRef(null)
  const [shown, setShown] = useState(0)
  const max = model?.caps.multiShot ? MAX_PLANS : 1
  const active = Math.min(shown, Math.max(0, plans.length - 1)) // moins de plans (autre modèle, rechargement) : le dernier
  const s = planTabsState(plans, active, { max, onChange, setActive: setShown, newDur: durationsFor(model)[0] ?? 5 })
  const cur = plans[active] ?? { text: '', dur: 5 }
  const total = plans.reduce((n, p) => n + (Number(p.dur) || 0), 0)
  const cites = tokenItems(inputs).map((x) => ({ ...x, input: inputs.find((i) => i.idx === x.idx) }))
  const known = new Set(cites.map((x) => x.token))
  const items = cites.map((x) => ({ key: `tpl-${x.idx}`, token: x.token, label: x.token, sub: x.title, asset: pseudoAsset(x.input, x.title) }))
  const stale = [...new Set((cur.text.match(new RegExp(`@${TOKEN_PATTERN}(?!\\d)`, 'g')) ?? []).map((t) => t.slice(1)).filter((t) => !known.has(t)))]
  const setText = (text) => onChange(plans.map((p, k) => (k === active ? { ...p, text } : p)))
  const durs = durationsFor(model, cur.dur)
  return (
    <section className="adm-card tm-sec tm-plans" aria-labelledby="tm-pl-t">
      <div className="ep-row">
        <PlanTabs s={s} single={max === 1} singleReason="Ce modèle ne fait qu’un plan" controls="tm-plan" headingId="tm-pl-t" />
        <small className="tm-total">{total} s au total</small>
      </div>
      {cites.length > 0 && (
        <div className="ep-tiles tm-cites" aria-label="Entrées à citer dans le plan">
          {cites.map((x) => (x.input.url
            ? <RefTile key={x.idx} asset={pseudoAsset(x.input, x.title)} token={x.token} onCite={() => area.current?.insertAt(x.token)} />
            : (
              <div key={x.idx} className="ep-tile" title={x.title}>
                <button type="button" className="ep-pick" aria-label={`Citer ${x.token} (${x.title}) dans le texte`} onClick={() => area.current?.insertAt(x.token)} />
                <Icon name={x.input.kind === 'video' ? 'vid' : x.input.kind === 'audio' ? 'mus' : 'img'} size={20} />
                <span>{x.token}</span>
              </div>
            )))}
        </div>
      )}
      <PromptBox
        id="tm-plan" role={s.multi ? 'tabpanel' : undefined} aria-labelledby={s.multi ? `plan-tab-${active}` : undefined}
        canClear={Boolean(cur.text)} onClear={() => setText('')} clearLabel="Effacer le plan"
        note={stale.length > 0 && <p className="ep-refnote" role="status">{stale.map((t) => `@${t}`).join(', ')} : aucune entrée ne porte ce nom.</p>}
        foot={<>
          {cites.length > 0 && <button type="button" className="ep-at" aria-label="Citer une entrée" onClick={() => area.current?.insertAt()}><Icon name="at" size={16} /></button>}
          {durs.length > 0 && (
            <Menu items={durs.map((d) => ({ id: d, title: `${d} s` }))} value={cur.dur} onChange={(dur) => onChange(plans.map((p, k) => (k === active ? { ...p, dur: Number(dur) } : p)))}
              label={`Durée du plan ${active + 1}`} menuWidth={160} className="ep-chip">
              <Icon name="clock" size={16} />{cur.dur} s
            </Menu>
          )}
        </>}
      >
        <MentionTextarea
          ref={area}
          value={cur.text}
          onChange={setText}
          items={items}
          pattern={TOKEN_PATTERN}
          isRef={(t) => known.has(t)}
          emptyHint="Ajoutez une entrée pour pouvoir la citer ici."
          placeholder={s.multi ? `Ce qui se passe dans le plan ${active + 1}. Tapez @ pour citer une entrée.` : 'Ce qui se passe dans la vidéo. Tapez @ pour citer une entrée.'}
          aria-label={s.multi ? `Plan ${active + 1}` : 'Plan'}
          maxLength={2000}
          rows={4}
        />
      </PromptBox>
      {plans.length > max && <p className="tm-warn">Ce modèle ne fait qu’un plan : retirez les autres.</p>}
    </section>
  )
}

/** Réglages Genjutsu : outil, vidéo source (durée mesurée, sinon saisie), consigne qui reste sur le serveur. */
function GenjutsuFields({ g, setG, ratio, onRatio, uploading, onSource, sourceInfo }) {
  const ratios = ratio && !GENJUTSU_RATIOS.includes(ratio) ? [ratio, ...GENJUTSU_RATIOS] : GENJUTSU_RATIOS
  return (
    <>
      <div className="tm-grid">
        <label className="adm-field">
          <span>Outil</span>
          <select value={g.tool} onChange={(e) => setG({ tool: e.target.value })}>
            {GENJUTSU_TOOLS.map((id) => <option key={id} value={id}>{findTool(id)?.name ?? id}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>Durée de la source (s)</span>
          <input type="number" min={GENJUTSU_LIMITS.minSecs} max={GENJUTSU_LIMITS.maxSecs} step="0.1" value={g.secs ?? ''} onChange={(e) => setG({ secs: e.target.value === '' ? null : Number(e.target.value) })} />
          <small className="tm-note">{sourceInfo?.measured ? 'Mesurée sur la vidéo : fixe le prix.' : `De ${GENJUTSU_LIMITS.minSecs} à ${GENJUTSU_LIMITS.maxSecs} s ; fixe le prix.`}</small>
        </label>
        <label className="adm-field">
          <span>Format</span>
          <select value={ratio ?? ''} onChange={(e) => onRatio(e.target.value || null)}>
            <option value="">Non précisé (16:9)</option>
            {ratios.map((r) => <option key={r} value={r}>{r === 'auto' ? 'Auto' : r}</option>)}
          </select>
          <small className="tm-note">Celui de la vidéo source : il règle la carte dans Cinéma.</small>
        </label>
      </div>
      <div className="tm-drop">
        <span className="tm-thumb">{g.source ? <video src={`${g.source}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" /> : <Icon name="play" size={18} />}</span>
        <div>
          <b>{sourceInfo?.name ?? (fileName(g.sourceKey) || 'Aucune vidéo source')}</b>
          {sourceInfo && <span>{mo(sourceInfo.size)}</span>}
          <span className="tm-note">Vidéo source envoyée à Genjutsu (originale, 720p au moins, 100 Mo au plus).</span>
        </div>
        <FileButton accept={ACCEPT.source} busy={uploading} label={g.sourceKey ? 'Remplacer' : 'Déposer'} onFile={onSource} />
      </div>
      <label className="adm-field">
        <span>Consigne envoyée à Genjutsu</span>
        <textarea value={g.prompt} maxLength={GENJUTSU_LIMITS.prompt} onChange={(e) => setG({ prompt: e.target.value })} placeholder="Ex. : Personne A au centre, personne B à droite. Garder le décor." />
        <small className="tm-note">Reste sur le serveur : l’utilisateur ne la voit jamais.</small>
      </label>
    </>
  )
}

/** Photos demandées (Genjutsu) : un rôle par photo, dans l'ordre que la consigne désigne. */
function Roles({ roles, onChange }) {
  return (
    <section className="adm-card tm-sec" aria-labelledby="tm-r-t">
      <h3 id="tm-r-t">Photos demandées <small>une par rôle, dans cet ordre</small></h3>
      {roles.map((r, n) => (
        <div key={n} className="tm-role">
          <label className="adm-field">
            <span>Rôle {n + 1}</span>
            <input value={r} maxLength={GENJUTSU_LIMITS.role} onChange={(e) => onChange(roles.map((x, k) => (k === n ? e.target.value : x)))} placeholder="Ex. : Personne A, au centre" />
          </label>
          {roles.length > 1
            ? <button type="button" className="tm-icon" aria-label={`Retirer le rôle ${n + 1}`} onClick={() => onChange(roles.filter((_, k) => k !== n))}><Icon name="close" size={16} /></button>
            : <span />}
        </div>
      ))}
      {roles.length < GENJUTSU_LIMITS.roles && <button type="button" className="adm-btn sm tm-add" onClick={() => onChange([...roles, ''])}><Icon name="plus" size={14} />Ajouter un rôle</button>}
    </section>
  )
}

/** Suppression définitive : il faut retaper le nom du modèle. */
function DeleteDialog({ id, name, onClose, onDeleted }) {
  const ref = useRef(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { ref.current?.showModal?.() }, [])
  const close = () => { if (!busy) onClose() }
  const ok = typed.trim() === name.trim()
  const submit = async (e) => {
    e.preventDefault()
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await api.adminDeleteTemplate(id)
      onDeleted()
    } catch (err) {
      setError(templateError(err).message)
      setBusy(false)
    }
  }
  return (
    <dialog ref={ref} className="adm-dlg" aria-labelledby="tm-del-t" onCancel={(e) => { e.preventDefault(); close() }}>
      <form onSubmit={submit}>
        <div className="adm-dlg-top">
          <h2 id="tm-del-t">Supprimer définitivement</h2>
          <button type="button" className="adm-x" aria-label="Fermer" onClick={close}><Icon name="close" size={16} /></button>
        </div>
        <div className="adm-dlg-body">
          <p>Le modèle disparaît de Modèles et ses fichiers sont effacés. Les vidéos déjà créées par les utilisateurs restent.</p>
          <label className="adm-field">
            <span>Tapez « {name} » pour confirmer</span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" />
          </label>
          {error && <p className="adm-err" role="alert">{error}</p>}
        </div>
        <div className="adm-dlg-foot">
          <button type="button" className="adm-btn" onClick={close} disabled={busy}>Annuler</button>
          <button type="submit" className="adm-btn danger solid" disabled={!ok || busy}>{busy ? 'Suppression…' : 'Supprimer'}</button>
        </div>
      </form>
    </dialog>
  )
}
