import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { RechargeButton } from '../../lib/rechargeDialog.jsx'
import { stopQuestion } from '../../lib/stopQuestion.js'
import { busyProps, useLaunch } from '../../lib/useLaunch.js'
import { useToast } from '../../lib/toasts.jsx'
import BusySpin from '../BusySpin.jsx'
import Icon from '../../lib/icons.jsx'
import { FAILURES, jetonLabel, jetons, useJobs } from '../../lib/jobs.jsx'
import { Amount } from '../Cauri.jsx'

export const LABEL = { IN_QUEUE: 'En file d’attente', IN_PROGRESS: 'En cours', COMPLETED: 'Terminée', FAILED: 'Échec', CANCELED: 'Annulée' }
export const isActive = (j) => j.status === 'IN_QUEUE' || j.status === 'IN_PROGRESS'
export const seconds = (ms) => Math.max(1, Math.round(ms / 1000))
export const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n))
export const remaining = (job) => seconds(job.duration * (1 - job.progress / 100))

export function StatusChip({ job }) {
  return <span className={`gx-chip gx-chip-${job.status.toLowerCase().replace('_', '-')}`}>{LABEL[job.status]}</span>
}

/** Phrase d'état unique, réutilisée par les trois mises en page. */
export function StatusLine({ job, running }) {
  if (job.live && job.status === 'IN_QUEUE') return <>{job.queuePosition > 0 ? `Position ${job.queuePosition} · ` : ''}en file chez le fournisseur</>
  if (job.live && job.status === 'IN_PROGRESS') return <>≈ {Math.round(job.progress)} % (estimation) · {job.logs[job.logs.length - 1].msg}</>
  if (job.status === 'IN_QUEUE') return <>Position {job.queuePosition} · attente ≈ {seconds(job.eta)} s · {running} en cours (limite : 2)</>
  if (job.status === 'IN_PROGRESS') return <>{Math.round(job.progress)} % · ≈ {remaining(job)} s restantes · {job.logs[job.logs.length - 1].msg}</>
  if (job.status === 'COMPLETED') return <>Terminée en {seconds(job.finishedAt - job.startedAt)} s · <Amount n={job.cost} word />{job.attempt > 1 ? ` · tentative ${job.attempt}` : ''}</>
  return null
}

export function FailureNotice({ job }) {
  if (job.status !== 'FAILED') return null
  const f = FAILURES[job.failure]
  return (
    <div className="gx-err" role="alert">
      <b>{f.message}</b>
      <span>{f.hint}</span>
      {job.failure === 'insufficient' && <RechargeButton className="gx-topup">Recharger mes cauris</RechargeButton>}
    </div>
  )
}

export function RefundNote({ job }) {
  // Arrêt d'une génération réelle : tant que le serveur n'a pas répondu, la carte n'annonce rien sur les cauris (lib/jobs.jsx).
  if (job.status === 'CANCELED' && job.cancelPending) return <p className="gx-refund gx-norefund">Arrêt en cours…</p>
  // Arrêtée par l'utilisateur sans remboursement (elle avait commencé chez le fournisseur, d'après le serveur) : on le dit, pour
  // que la carte ne laisse pas croire à un remboursement annoncé avant l'arrêt. Arrêtée par le support : la raison n'est pas connue.
  if (job.status === 'CANCELED' && job.live && job.canceledBy === 'user' && job.refund === 0) return <p className="gx-refund gx-norefund">Non remboursé : la génération avait déjà commencé.</p>
  if ((job.status !== 'FAILED' && job.status !== 'CANCELED') || !(job.refund > 0)) return null
  return (
    <p className="gx-refund">
      <Icon name="check" size={14} />Remboursé : +<Amount n={job.refund} word />{job.status === 'CANCELED' && job.refund < job.cost ? ' (part non consommée)' : ''}
    </p>
  )
}

/** Bouton « refaire » (↺ et son coût) : il lance une génération payante, donc un seul envoi par appui (voir lib/useLaunch.js). */
function RedoButton({ job, label, onRun, main }) {
  const [busy, run] = useLaunch(onRun)
  const el = useRef(null)
  // Le bouton disparaît quand la carte passe à la génération qu'il vient de lancer (scène vidéo) : s'il avait le focus du clavier,
  // celui-ci va au groupe d'actions plutôt que de se perdre en haut de page.
  useLayoutEffect(() => {
    const btn = el.current
    return () => {
      const group = document.activeElement === btn ? btn.closest('.ax') : null
      if (group) requestAnimationFrame(() => { if (group.isConnected && (!document.activeElement || document.activeElement === document.body)) group.focus() })
    }
  }, [])
  return (
    <button type="button" ref={el} className={main ? 'main' : undefined} {...busyProps(busy)} onClick={() => run()} title={`${label} · ${jetonLabel(job.cost)}`} aria-label={`${label} : ${job.title} (${jetonLabel(job.cost)})`}>
      {busy ? <><BusySpin /><span>Envoi…</span></> : <><Icon name="revert" size={17} /><span>{jetons(job.cost)}</span></>}
    </button>
  )
}

/**
 * Question posée avant d'arrêter une génération : ce qu'il advient des cauris (lib/stopQuestion.js), puis « Arrêter » et
 * « Continuer » (choix par défaut, il reçoit le focus). Échap et un appui en dehors ferment comme « Continuer ».
 * Dans la carte quand elle a la place (`modal` faux : panneau posé en bas de l'asset) ; sinon, même contenu dans une fenêtre
 * centrée (`<dialog>` : tuiles d'image en grille, bandes audio). La phrase suit l'état : en file puis en cours, elle change.
 */
function StopConfirm({ job, modal, onStop, onClose }) {
  const q = stopQuestion(job, jetonLabel)
  const id = useId()
  const box = useRef(null)
  const keep = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  // Le second appui d'un double appui sur ✕ peut tomber sur « Arrêter » ou « Continuer », posés là où était le ✕ : les boutons
  // n'agissent qu'une demi-seconde après l'ouverture de la question.
  const born = useRef(Date.now())
  const settled = (fn) => () => { if (Date.now() - born.current >= 500) fn() }
  useEffect(() => {
    const el = box.current
    if (modal) { if (!el.open) el.showModal() } else {
      const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close.current() } }
      // Un appui en dehors ferme la question et rien d'autre : il n'active pas ce qui se trouve sous le doigt (un « Refaire », un
      // « Régénérer » payant). L'appui est retenu ici, et le clic qui le suit est avalé (voir `swallowClick`).
      const opened = Date.now()
      const out = (e) => {
        if (el.contains(e.target)) return
        // Le second appui d'un double appui sur ✕ tombe là où était le ✕ : il est avalé sans fermer la question.
        if (Date.now() - opened < 500) { e.preventDefault(); e.stopPropagation(); swallowClick(); return }
        e.preventDefault(); e.stopPropagation()
        swallowClick()
        close.current()
      }
      document.addEventListener('keydown', key)
      window.addEventListener('pointerdown', out, true)
      keep.current?.focus()
      return () => { document.removeEventListener('keydown', key); window.removeEventListener('pointerdown', out, true) }
    }
    keep.current?.focus()
  }, [modal])
  // Panneau dans la carte : Tab passe d'un bouton à l'autre sans quitter la question (la fenêtre <dialog> le fait d'elle-même).
  const trap = (e) => {
    if (modal || e.key !== 'Tab') return
    const btns = [...box.current.querySelectorAll('button')]
    const i = btns.indexOf(document.activeElement)
    e.preventDefault()
    btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus()
  }
  const body = (
    <>
      <div className="gx-stop-tx">
        <b id={`${id}-t`}>{q.title}</b>
        <span id={`${id}-d`}>{q.before}<b>{q.amount}</b>{q.after}</span>
      </div>
      <div className="gx-stop-btns">
        <button type="button" onClick={settled(onStop)}>Arrêter</button>
        <button type="button" className="keep" ref={keep} onClick={settled(onClose)}>Continuer</button>
      </div>
    </>
  )
  const a11y = { role: 'alertdialog', 'aria-labelledby': `${id}-t`, 'aria-describedby': `${id}-d` }
  if (modal) {
    return (
      <dialog ref={box} className="gx-stop-dlg" {...a11y} onCancel={(e) => { e.preventDefault(); onClose() }} onClick={(e) => e.target === box.current && settled(onClose)()}>
        <div className="gx-stop">{body}</div>
      </dialog>
    )
  }
  return <div ref={box} className="gx-stop in" {...a11y} onKeyDown={trap}>{body}</div>
}

// Avale le clic qui suit un appui (s'il vient : un glissement n'en produit pas), où qu'il tombe.
function swallowClick() {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); off() }
  const off = () => { clearTimeout(t); window.removeEventListener('click', stop, true) }
  const t = setTimeout(off, 800)
  window.addEventListener('click', stop, true)
}

// Place qu'il faut à la question pour tenir dans la carte (largeur, hauteur) ; en dessous, elle s'ouvre en fenêtre centrée.
const ROOM = [280, 210]
// Une génération lancée à l'instant n'ouvre pas la question : son ✕ apparaît là où l'on vient d'appuyer pour la lancer.
const FRESH_MS = 700

/**
 * Actions de l'asset, en icônes empilées sur l'asset lui-même (à une position fixe) :
 * stop (en file / en cours), refaire (↺ avec son coût), modifier la description (✎) et retirer (corbeille).
 * `dir="row"` les aligne horizontalement (bandes audio). Stop n'arrête pas tout de suite : il pose d'abord la question (StopConfirm).
 */
export function AssetActions({ job, dir = 'col', className = '', children }) {
  const { cancel, retry, rerun, dismiss } = useJobs()
  const toast = useToast()
  const { status } = job
  const retryable = job.failure && FAILURES[job.failure].retry
  const focusPrompt = () => document.querySelector('[data-prompt]')?.focus()
  const redo = (label, fn, main) => <RedoButton key={job.id} job={job} label={label} onRun={fn} main={main} />
  const ax = useRef(null)
  const stop = useRef(null)
  const [asking, setAsking] = useState(null) // { id, modal } : la question est ouverte pour cette génération
  const open = asking?.id === job.id && isActive(job) // la génération se termine, échoue ou change : la question se ferme d'elle-même
  const ask = () => {
    if (Date.now() - job.createdAt < FRESH_MS) return // second appui d'un double appui sur « Réessayer » : le ✕ vient de prendre sa place
    const host = ax.current?.offsetParent // le cadre où le panneau se poserait (l'asset)
    setAsking({ id: job.id, modal: !(host && host.clientWidth >= ROOM[0] && host.clientHeight >= ROOM[1]) })
  }
  const was = useRef(false)
  useEffect(() => {
    if (asking && !open) setAsking(null)
    // À la fermeture, le focus revient au ✕ s'il n'est pas déjà parti ailleurs. La génération n'est plus active (arrêtée, ou finie
    // pendant que la question était ouverte) : il va au groupe d'actions, jamais sur un bouton. Le premier est payant (Régénérer,
    // Réessayer, Relancer), et la touche Entrée destinée à « Continuer » lancerait une génération.
    if (was.current && !open && (!document.activeElement || document.activeElement === document.body)) (stop.current ?? ax.current)?.focus()
    was.current = open
  }, [asking, open])
  return (
    <>
    <div ref={ax} tabIndex={-1} className={`ax ${dir === 'row' ? 'row' : ''} ${className}${open && !asking.modal ? ' ax-hold' : ''}`}>
      {children}
      {isActive(job) && (
        <button type="button" ref={stop} onClick={ask} aria-haspopup="dialog" aria-expanded={open} title={status === 'IN_QUEUE' ? 'Annuler · remboursé en entier' : job.live ? 'Annuler · déjà en cours chez le fournisseur : non remboursé' : 'Annuler · part non consommée remboursée'} aria-label={`Annuler : ${job.title}`}>
          <Icon name="close" size={17} />
        </button>
      )}
      {status === 'COMPLETED' && redo('Régénérer', () => rerun(job))}
      {status === 'FAILED' && retryable && redo('Réessayer', () => retry(job), true)}
      {status === 'FAILED' && !retryable && (
        <button type="button" className="main" onClick={focusPrompt} title="Modifier la description" aria-label="Modifier la description">
          <Icon name="pencil" size={17} />
        </button>
      )}
      {status === 'CANCELED' && redo('Relancer', () => retry(job))}
      {!isActive(job) && (
        <button type="button" onClick={() => dismiss(job.id)} title="Retirer" aria-label={`Retirer : ${job.title}`}>
          <Icon name="trash" size={17} />
        </button>
      )}
    </div>
    {open && <StopConfirm job={job} modal={asking.modal} onStop={() => { setAsking(null); cancel(job.id).then((ok) => ok || toast?.('L’arrêt n’a pas abouti : la génération continue.')) }} onClose={() => setAsking(null)} />}
    </>
  )
}
