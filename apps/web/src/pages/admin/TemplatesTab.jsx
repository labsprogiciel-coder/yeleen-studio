import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../lib/icons.jsx'
import { api } from '../../lib/api.js'
import { caurisLabel } from '../../lib/admin.js'
import { categoryLabel } from '../../lib/templates.js'
import { NAME_MAX, fabrication, filterTemplates, issueText, moveBefore, moveStep, serialLatest, summarize, templateError, templatePrice } from '../../lib/adminTemplates.js'
import TemplateEditor from './TemplateEditor.jsx'
import Switch from './Switch.jsx'

/**
 * Onglet « Modèles » de l'administration : les vidéos à refaire, dans l'ordre vu par les utilisateurs. Recherche, filtres, ordre
 * (glisser ou ↑/↓), publication, création ; `id` (paramètre `m` de l'adresse) ouvre l'éditeur d'un modèle.
 */
export default function TemplatesTab({ id, open }) {
  if (id) return <TemplateEditor key={id} id={id} onBack={() => open(null)} />
  return <TemplatesList open={open} />
}

const FILTERS = [['all', 'Tous'], ['published', 'Publiés'], ['draft', 'Brouillons'], ['fix', 'À corriger']]

function TemplatesList({ open }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState(null) // { id, text, issues } : refus d'une publication, ou échec du classement
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(null) // id en cours de publication
  const [drag, setDrag] = useState(null)
  const seq = useRef(0)

  const load = useCallback(() => {
    const n = ++seq.current
    setError(null)
    api.adminTemplates().then((r) => { if (n === seq.current) setList(r.templates ?? []) })
      .catch((e) => { if (n === seq.current) setError(templateError(e).message) })
  }, [])
  useEffect(() => { load() }, [load])

  const all = list ?? []
  const shown = filterTemplates(all, { q, filter })
  const sum = summarize(all)

  // Nouvel ordre : affiché tout de suite, envoyé en entier ; un envoi à la fois, le dernier ordre demandé partant en dernier.
  // En cas d'échec, la liste revient de l'API.
  const sendOrder = useRef(null)
  if (!sendOrder.current) {
    sendOrder.current = serialLatest((ids) => api.adminOrderTemplates(ids), (e) => { setNotice({ text: `Ordre non enregistré : ${templateError(e).message}` }); load() })
  }
  const reorder = (ids) => {
    if (!ids) return
    const byId = new Map(all.map((t) => [t.id, t]))
    setList(ids.map((x) => byId.get(x)))
    setNotice(null)
    sendOrder.current(ids)
  }
  const ids = all.map((t) => t.id)

  const publish = async (t) => {
    setBusy(t.id)
    setNotice(null)
    try {
      const r = await api.adminPublishTemplate(t.id, !t.published)
      setList((l) => l.map((x) => (x.id === t.id ? r.template ?? { ...x, published: !t.published } : x)))
    } catch (e) {
      const err = templateError(e)
      setNotice({ id: t.id, text: `« ${t.name} » : ${err.message}`, issues: err.issues.map((i) => issueText(i, t.inputs)) })
    } finally { setBusy(null) }
  }

  return (
    <>
      <div className="adm-toolbar tm-bar">
        <label className="adm-field adm-q tm-q">
          <span className="sr">Rechercher un modèle</span>
          <Icon name="search" size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, catégorie ou modèle" />
        </label>
        <div className="adm-seg" role="group" aria-label="Modèles montrés">
          {FILTERS.map(([v, label]) => <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>{label}</button>)}
        </div>
        <button type="button" className="adm-btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />Nouveau modèle</button>
      </div>
      {list && (
        <p className="tm-sum">
          <span><b>{sum.total}</b> modèle{sum.total > 1 ? 's' : ''}</span>
          <span><b>{sum.published}</b> publié{sum.published > 1 ? 's' : ''}</span>
          <span><b>{sum.fix}</b> à corriger</span>
          <span>Glissez <span aria-hidden="true">⋮⋮</span> ou utilisez ↑ ↓ pour changer l’ordre affiché aux utilisateurs.</span>
        </p>
      )}
      {notice && (
        <div className="adm-err tm-notice" role="alert">
          <p>{notice.text}</p>
          {notice.issues?.length > 0 && <ul>{notice.issues.map((m, n) => <li key={n}>{m}</li>)}</ul>}
          {notice.id && <button type="button" className="adm-btn sm" onClick={() => open(notice.id)}>Corriger</button>}
        </div>
      )}
      <div className="adm-card">
        {error && <p className="adm-err" role="alert">{error} <button type="button" className="adm-btn sm" onClick={load}>Réessayer</button></p>}
        {!error && !shown.length && <p className="adm-note" aria-live="polite">{!list ? 'Chargement…' : all.length ? 'Aucun modèle ne correspond.' : 'Aucun modèle pour l’instant.'}</p>}
        {shown.length > 0 && (
          <ul className="tm-list" aria-label="Modèles, dans l’ordre affiché aux utilisateurs">
            <li className="tm-row head" aria-hidden="true"><span /><span>Vidéo</span><span>Modèle</span><span>Fabrication</span><span>Catégorie</span><span>Prix</span><span>État</span><span /></li>
            {shown.map((t, n) => {
              const f = fabrication(t)
              const price = templatePrice(t)
              return (
                <li key={t.id} className={`tm-row${drag === t.id ? ' dragging' : ''}`}
                  onDragOver={(e) => { if (drag) e.preventDefault() }}
                  onDrop={(e) => { e.preventDefault(); if (drag && drag !== t.id) reorder(moveBefore(ids, drag, t.id)); setDrag(null) }}>
                  <span className="tm-order">
                    <span className="tm-grip" draggable title="Glisser pour déplacer" aria-hidden="true"
                      onDragStart={(e) => { setDrag(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id) }}
                      onDragEnd={() => setDrag(null)}>⋮⋮</span>
                    <button type="button" className="tm-step" disabled={n === 0} aria-label={`Monter « ${t.name} »`} onClick={() => reorder(moveStep(ids, shown.map((x) => x.id), t.id, -1))}>↑</button>
                    <button type="button" className="tm-step" disabled={n === shown.length - 1} aria-label={`Descendre « ${t.name} »`} onClick={() => reorder(moveStep(ids, shown.map((x) => x.id), t.id, 1))}>↓</button>
                  </span>
                  <span className="tm-thumb">
                    {t.video ? <video src={`${t.video}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" /> : <Icon name="play" size={18} />}
                  </span>
                  <span className="tm-name">
                    <button type="button" className="tm-link" onClick={() => open(t.id)}>{t.name}</button>
                    {t.blurb && <small>{t.blurb}</small>}
                  </span>
                  <span className="tm-type">
                    <b>{f.kind}</b>
                    <small className={f.error ? 'tm-warn' : ''}>{f.detail}</small>
                    {!f.error && t.issues?.length > 0 && <small className="tm-warn">{t.issues.length} point{t.issues.length > 1 ? 's' : ''} à corriger</small>}
                  </span>
                  <span className="tm-cat"><span className="tm-tag">{categoryLabel(t.category)}</span></span>
                  <span className="tm-cost">{price ? caurisLabel(price.total) : '— cauris'}{price && <small>{String(price.secs).replace('.', ',')} s</small>}</span>
                  <Switch on={t.published} busy={busy === t.id} onToggle={() => publish(t)} label={t.name} />
                  <span className="tm-acts"><button type="button" className="adm-btn sm" onClick={() => open(t.id)}>Modifier</button></span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {creating && <NewTemplateDialog onClose={() => setCreating(false)} onCreated={(t) => open(t.id)} />}
    </>
  )
}

/** Petite fenêtre « Nouveau modèle » : le nom suffit, l'éditeur s'ouvre ensuite. */
function NewTemplateDialog({ onClose, onCreated }) {
  const ref = useRef(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { ref.current?.showModal?.() }, [])
  const close = () => { if (!busy) onClose() }
  const submit = async (e) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) { setError('Donnez un nom au modèle.'); return }
    setBusy(true)
    setError(null)
    try {
      const r = await api.adminCreateTemplate({ name: n })
      onCreated(r.template)
    } catch (err) {
      setError(templateError(err).message)
      setBusy(false)
    }
  }
  return (
    <dialog ref={ref} className="adm-dlg" aria-labelledby="tm-new-t" onCancel={(e) => { e.preventDefault(); close() }}>
      <form onSubmit={submit}>
        <div className="adm-dlg-top">
          <h2 id="tm-new-t">Nouveau modèle</h2>
          <button type="button" className="adm-x" aria-label="Fermer" onClick={close}><Icon name="close" size={16} /></button>
        </div>
        <div className="adm-dlg-body">
          <p>Il reste en brouillon : vous le compléterez dans l’éditeur avant de le publier.</p>
          <label className="adm-field">
            <span>Nom</span>
            <input autoFocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} disabled={busy} placeholder="Ex. : Pub boisson fraîche" />
          </label>
          {error && <p className="adm-err" role="alert">{error}</p>}
        </div>
        <div className="adm-dlg-foot">
          <button type="button" className="adm-btn" onClick={close} disabled={busy}>Annuler</button>
          <button type="submit" className="adm-btn primary" disabled={busy}>{busy ? 'Création…' : 'Créer et modifier'}</button>
        </div>
      </form>
    </dialog>
  )
}
