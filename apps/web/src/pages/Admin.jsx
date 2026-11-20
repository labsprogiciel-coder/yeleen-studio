import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ShellHeader, SkipLink } from '../components/Headers.jsx'
import Icon from '../lib/icons.jsx'
import useDocumentTitle from '../lib/useDocumentTitle.js'
import useTabKeys from '../lib/useTabKeys.js'
import { api } from '../lib/api.js'
import { fcfa } from '../lib/topups.js'
import {
  ACTIONS, JOB_STATUS, LEDGER_KIND, MAX_ADJUST, TOPUP_STATUS, adminError, adminKey, ageMin, canRecheck, cauris, caurisLabel, checkReason,
  failureKind, formatAge, formatDate, isActiveJob, isStuckJob, isStuckTopup, parseAmount, pick, refundable, resultText, sortTopups,
} from '../lib/admin.js'
import '../styles/shell.css'
import '../styles/admin.css'

/**
 * Administration : retrouver un compte et agir dessus (solde, remboursement, annulation, blocage), suivre les générations en cours
 * et les recharges de tous les comptes. Toutes les décisions sont prises par l'API (garde ADMIN_USER_IDS, montants, idempotence) ;
 * cette page n'affiche que ce qu'elle renvoie. Le solde d'un compte cible n'est jamais versé dans le solde affiché de l'administrateur.
 */
const TABS = [
  { id: 'users', label: 'Utilisateurs' },
  { id: 'jobs', label: 'Générations en cours' },
  { id: 'topups', label: 'Recharges' },
]

/** Liste d'une réponse, quel que soit son nom (`users`, `jobs`…), ou la réponse elle-même si c'est un tableau. */
const rows = (r, name) => (Array.isArray(r) ? r : r?.[name] ?? r?.results ?? r?.rows ?? [])

/** Chargement d'une ressource de l'API, rechargeable. */
function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const seq = useRef(0)
  const load = useCallback(() => {
    const n = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then((data) => { if (n === seq.current) setState({ loading: false, data, error: null }) })
      .catch((e) => { if (n === seq.current) setState({ loading: false, data: null, error: adminError(e) }) })
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}

export default function Admin() {
  useDocumentTitle('Administration')
  const [params, setParams] = useSearchParams()
  const tab = Math.max(0, TABS.findIndex((t) => t.id === params.get('t')))
  const uid = params.get('u') ?? ''
  const onTabKeys = useTabKeys()
  const [dialog, setDialog] = useState(null) // { spec, n } : `n` change à chaque ouverture, donc une clé d'idempotence neuve
  const openAction = useCallback((spec) => setDialog((d) => ({ spec, n: (d?.n ?? 0) + 1 })), [])
  const go = (next) => setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)))

  return (
    <div className="pg shell adm">
      <SkipLink />
      <ShellHeader />
      <main className="adm-main" id="main" tabIndex={-1}>
        <div className="adm-head">
          <h1>Administration</h1>
          <div className="adm-tabs" role="tablist" aria-label="Administration" onKeyDown={onTabKeys}>
            {TABS.map((t, i) => (
              <button key={t.id} id={`admt-${i}`} type="button" role="tab" aria-selected={tab === i} aria-controls="adm-panel" tabIndex={tab === i ? 0 : -1} className={tab === i ? 'on' : ''} onClick={() => go({ t: t.id, u: t.id === 'users' ? uid : '' })}>{t.label}</button>
            ))}
          </div>
        </div>
        <section className="adm-panel" role="tabpanel" id="adm-panel" aria-labelledby={`admt-${tab}`}>
          {tab === 0 && <UsersTab uid={uid} select={(u) => go({ t: 'users', u })} openAction={openAction} />}
          {tab === 1 && <JobsTab openAction={openAction} />}
          {tab === 2 && <TopupsTab openAction={openAction} />}
        </section>
      </main>
      {dialog && <ActionDialog key={dialog.n} spec={dialog.spec} onClose={() => setDialog(null)} />}
    </div>
  )
}

/* ——— Utilisateurs ——— */

function UsersTab({ uid, select, openAction }) {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const found = useLoad(() => api.adminUsers(query), [query])
  const users = rows(found.data, 'users')
  return (
    <div className={`adm-users${uid ? ' has-user' : ''}`}>
      <div className="adm-search">
        <form role="search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()) }}>
          <label className="adm-field">
            <span>Rechercher un compte</span>
            <div className="adm-row">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Identifiant, e-mail, téléphone ou génération" autoComplete="off" />
              <button type="submit" className="adm-btn"><Icon name="search" size={16} />Chercher</button>
            </div>
          </label>
        </form>
        {found.error && <p className="adm-err" role="alert">{found.error}</p>}
        <p className="adm-note" aria-live="polite">{found.loading ? 'Recherche…' : `${users.length} compte${users.length > 1 ? 's' : ''}${query ? '' : ' récents'}`}</p>
        <ul className="adm-list">
          {users.map((u) => (
            <li key={u.id}>
              <button type="button" className={u.id === uid ? 'on' : ''} aria-current={u.id === uid ? 'true' : undefined} onClick={() => select(u.id)}>
                <b>{u.email || u.name || u.id}</b>
                <span>{u.email && u.name ? `${u.name} · ` : ''}{u.id}</span>
                <span>{u.country ? `${u.country} · ` : ''}vu {formatDate(pick(u, 'lastSeenAt'))}</span>
                {pick(u, 'blockedAt') && <em className="adm-tag ko">Suspendu</em>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {uid
        ? <UserPanel key={uid} uid={uid} close={() => select('')} openAction={openAction} onChanged={found.reload} />
        : <p className="adm-empty">Choisissez un compte pour voir son solde, ses recharges et ses générations.</p>}
    </div>
  )
}

function UserPanel({ uid, close, openAction, onChanged }) {
  const { loading, data, error, reload } = useLoad(() => api.adminUser(uid), [uid])
  if (error) return <div className="adm-user"><p className="adm-err" role="alert">{error}</p><button type="button" className="adm-btn" onClick={reload}>Réessayer</button></div>
  if (!data) return <div className="adm-user"><p className="adm-note">Chargement du compte…</p></div>
  const { user = {}, balance, blocked } = data
  const topups = data.topups ?? []
  const jobs = data.jobs ?? []
  const ledger = data.ledger ?? []
  const actions = data.actions ?? []
  const who = user.email || user.name || uid
  const act = (spec) => openAction({ ...spec, onDone: () => { reload(); onChanged?.() } }) // la liste aussi (« Suspendu »)

  return (
    <div className="adm-user" aria-busy={loading}>
      <div className="adm-card adm-profile">
        <div className="adm-ph">
          <div>
            <h2>{who}</h2>
            <p className="adm-id">{uid}</p>
          </div>
          <button type="button" className="adm-x" aria-label="Fermer ce compte" onClick={close}><Icon name="close" size={16} /></button>
        </div>
        <dl className="adm-dl">
          <div><dt>Solde</dt><dd className="adm-num">{caurisLabel(balance)}</dd></div>
          <div><dt>Nom</dt><dd>{user.name || '—'}</dd></div>
          <div><dt>E-mail</dt><dd>{user.email || '—'}</dd></div>
          <div><dt>Pays</dt><dd>{user.country || '—'}</dd></div>
          <div><dt>Inscrit</dt><dd>{formatDate(pick(user, 'createdAt'))}</dd></div>
          <div><dt>Vu</dt><dd>{formatDate(pick(user, 'lastSeenAt'))}</dd></div>
        </dl>
        {blocked && (
          <p className="adm-blocked" role="status">
            <Icon name="lock" size={16} />
            <span>Compte suspendu le {formatDate(blocked.at)}{blocked.reason ? ` : « ${blocked.reason} »` : ''}{blocked.actor ? ` (par ${blocked.actor})` : ''}. Plus de générations, de recharges ni d’imports ; les générations en cours se terminent.</span>
          </p>
        )}
        <div className="adm-actions">
          <button type="button" className="adm-btn primary" onClick={() => act({
            action: 'adjust', title: 'Ajuster le solde', intro: `Solde actuel de ${who} : ${caurisLabel(balance)}. L’opération est inscrite dans l’historique du solde et le journal admin.`,
            directions: true, amount: true, max: MAX_ADJUST, confirm: 'Enregistrer',
            run: ({ key, reason, amount, direction }) => api.adminAdjust(uid, { key, direction, amount, reason }).then((r) => ({ amount, ...r })),
          })}>Ajuster le solde</button>
          {blocked
            ? <button type="button" className="adm-btn" onClick={() => act({
                action: 'unblock', title: 'Débloquer le compte', intro: `${who} pourra de nouveau générer, recharger et importer des fichiers.`, confirm: 'Débloquer',
                run: ({ key, reason }) => api.adminBlock(uid, { key, blocked: false, reason }),
              })}>Débloquer</button>
            : <button type="button" className="adm-btn danger" onClick={() => act({
                action: 'block', title: 'Bloquer le compte', intro: `${who} ne pourra plus lancer de génération, de recharge ni d’import. Les générations en cours et les paiements déjà lancés continuent.`, confirm: 'Bloquer', danger: true,
                run: ({ key, reason }) => api.adminBlock(uid, { key, blocked: true, reason }),
              })}>Bloquer</button>}
        </div>
      </div>

      <Section title="Recharges" count={topups.length}>
        <table className="adm-table">
          <thead><tr><th>Date</th><th>Référence</th><th>Montant</th><th>Opérateur</th><th>Statut</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>
            {topups.map((t) => (
              <tr key={t.reference}>
                <td>{formatDate(pick(t, 'createdAt'))}</td>
                <td className="adm-mono">{t.reference}</td>
                <td className="adm-num">{fcfaOf(t)}<br /><small>{caurisLabel(Number(t.jetons))}</small></td>
                <td>{t.operator ?? '—'}<br /><small>{t.phone ?? ''}</small></td>
                <td><TopupStatus t={t} /></td>
                <td>{canRecheck(t.status) && <button type="button" className="adm-btn sm" onClick={() => act(recheckSpec(uid, t))}>Revérifier</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Générations" count={jobs.length}>
        <table className="adm-table">
          <thead><tr><th>Date</th><th>Modèle</th><th>Statut</th><th>Coût</th><th>Rendu</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>
            {jobs.map((j) => {
              const left = refundable(j)
              return (
                <tr key={j.id}>
                  <td>{formatDate(pick(j, 'createdAt'))}</td>
                  <td>{pick(j, 'modelId') ?? j.kind ?? '—'}<br /><small className="adm-mono">{j.id}</small>{outputsOf(j).slice(0, 3).map((o, i) => <a key={i} className="adm-link" href={o} target="_blank" rel="noreferrer">Fichier {i + 1}</a>)}</td>
                  <td><JobStatus j={j} /></td>
                  <td className="adm-num">{cauris(Number(j.cost))}</td>
                  <td className="adm-num">{cauris(Number(j.refund) || 0)}</td>
                  <td>
                    {isActiveJob(j.status)
                      ? <button type="button" className="adm-btn sm danger" onClick={() => act(cancelSpec(uid, j))}>Annuler et rembourser</button>
                      : left > 0 && <button type="button" className="adm-btn sm" onClick={() => act(refundSpec(uid, j))}>Rembourser</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Historique du solde" count={ledger.length}>
        <table className="adm-table">
          <thead><tr><th>Date</th><th>Opération</th><th>Référence</th><th>Montant</th><th>Solde</th></tr></thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={`${l.kind}:${l.ref}`}>
                <td>{formatDate(l.at)}</td>
                <td>{LEDGER_KIND[l.kind] ?? l.kind}{String(l.ref).startsWith('adm_') && <em className="adm-tag">admin</em>}</td>
                <td className="adm-mono">{l.ref}</td>
                <td className={`adm-num ${l.delta < 0 ? 'neg' : 'pos'}`}>{l.delta > 0 ? '+' : ''}{cauris(Number(l.delta))}</td>
                <td className="adm-num">{l.balance == null ? '—' : cauris(Number(l.balance))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Actions admin" count={actions.length}>
        <table className="adm-table">
          <thead><tr><th>Date</th><th>Action</th><th>Montant</th><th>Référence</th><th>Motif</th><th>Par</th></tr></thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td>{formatDate(a.at)}</td>
                <td>{ACTIONS[a.action] ?? a.action}</td>
                <td className="adm-num">{a.amount == null ? '—' : cauris(Number(a.amount))}</td>
                <td className="adm-mono">{a.ref ?? '—'}</td>
                <td className="adm-reason">{a.reason}</td>
                <td className="adm-mono">{a.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}

/** Bloc repliable d'un tableau ; vide, il le dit au lieu d'un tableau sans lignes. */
function Section({ title, count, children }) {
  return (
    <details className="adm-card adm-sec" open>
      <summary><h3>{title}</h3><span className="adm-count">{count}</span></summary>
      {count ? <div className="adm-tw">{children}</div> : <p className="adm-note">Rien pour l’instant.</p>}
    </details>
  )
}

const fcfaOf = (t) => { const n = Number(pick(t, 'amountFcfa')); return Number.isFinite(n) ? fcfa(n) : '—' }

/** Adresses des fichiers produits (`outputs`, tableau ou JSON de D1). */
function outputsOf(j) {
  let o = j.outputs
  if (typeof o === 'string') { try { o = JSON.parse(o) } catch { o = [] } }
  return Array.isArray(o) ? o.map((x) => (typeof x === 'string' ? x : x?.url)).filter(Boolean) : []
}

function TopupStatus({ t, now = Date.now() }) {
  const stuck = isStuckTopup(t, now)
  const tone = t.status === 'completed' ? 'ok' : stuck || t.status === 'failed' || t.status === 'expired' ? 'ko' : ''
  return (
    <span className="adm-st">
      <em className={`adm-tag ${tone}`}>{TOPUP_STATUS[t.status] ?? t.status}</em>
      {stuck && <em className="adm-tag ko">Bloquée · {formatAge(ageMin(pick(t, 'createdAt'), now))}</em>}
      {t.mismatch && <em className="adm-tag ko">Montant différent</em>}
      {t.late ? <em className="adm-tag">En retard</em> : null}
    </span>
  )
}

function JobStatus({ j, now = Date.now() }) {
  const stuck = isActiveJob(j.status) && isStuckJob(j, now)
  const tone = j.status === 'COMPLETED' ? 'ok' : j.status === 'FAILED' || stuck ? 'ko' : ''
  return (
    <span className="adm-st">
      <em className={`adm-tag ${tone}`}>{JOB_STATUS[j.status] ?? j.status}</em>
      {stuck && <em className="adm-tag ko">Bloquée · {formatAge(j.ageMin ?? ageMin(pick(j, 'createdAt'), now))}</em>}
      {j.failure && <small>{j.failure}</small>}
    </span>
  )
}

/* Fenêtres d'action partagées par les trois onglets. */

const recheckSpec = (uid, t, onDone) => ({
  action: 'recheck_topup', title: 'Revérifier la recharge', onDone,
  intro: `La recharge ${t.reference} (${fcfaOf(t)}) est redemandée à Paygate. Si elle est payée, elle est créditée par le chemin habituel ; jamais d’après un statut saisi ici.`,
  confirm: 'Revérifier',
  run: ({ key, reason }) => api.adminRecheck(uid, t.reference, { key, reason }),
})

const refundSpec = (uid, j, onDone) => ({
  action: 'refund_job', title: 'Rembourser la génération', onDone,
  intro: `Coût débité : ${caurisLabel(Number(j.cost))}. Un seul remboursement par génération, au plus ce coût. Laissez le montant vide pour tout rembourser.`,
  amount: true, optional: true, max: refundable(j), confirm: 'Rembourser',
  run: ({ key, reason, amount }) => api.adminRefund(uid, j.id, { key, reason, amount }),
})

const cancelSpec = (uid, j, onDone) => ({
  action: 'cancel_job', title: 'Annuler et rembourser', danger: true, onDone,
  intro: 'On redemande d’abord son état au fournisseur : si elle est terminée, elle est enregistrée avec ses fichiers et rien n’est remboursé. Sinon elle est annulée et son coût rendu.',
  confirm: 'Annuler et rembourser',
  run: ({ key, reason }) => api.adminCancel(uid, j.id, { key, reason }),
})

/* ——— Générations en cours ——— */

function JobsTab({ openAction }) {
  const [scope, setScope] = useState('active')
  const { loading, data, error, reload } = useLoad(() => api.adminJobs(scope), [scope])
  const now = Date.now()
  const jobs = [...rows(data, 'jobs')].sort((a, b) => isStuckJob(b, now) - isStuckJob(a, now))
  return (
    <div className="adm-card">
      <div className="adm-bar">
        <div className="adm-seg" role="group" aria-label="Générations montrées">
          <button type="button" aria-pressed={scope === 'active'} onClick={() => setScope('active')}>Toutes les actives</button>
          <button type="button" aria-pressed={scope === 'stuck'} onClick={() => setScope('stuck')}>Bloquées (+ de 30 min)</button>
        </div>
        <button type="button" className="adm-btn" onClick={reload} disabled={loading}><Icon name="revert" size={16} />Actualiser</button>
      </div>
      {error && <p className="adm-err" role="alert">{error}</p>}
      {!error && !loading && !jobs.length && <p className="adm-note">Aucune génération en cours.</p>}
      {jobs.length > 0 && (
        <div className="adm-tw">
          <table className="adm-table">
            <thead><tr><th>Compte</th><th>Modèle</th><th>Statut</th><th>Âge</th><th>Coût</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {jobs.map((j) => {
                const uid = pick(j, 'userId') ?? j.account
                return (
                  <tr key={j.id}>
                    <td><Link className="adm-link" to={`/admin?t=users&u=${encodeURIComponent(uid)}`}>{j.email || uid}</Link></td>
                    <td>{pick(j, 'modelId') ?? j.kind}<br /><small className="adm-mono">{j.id}</small></td>
                    <td><JobStatus j={j} now={now} /></td>
                    <td className="adm-num">{formatAge(j.ageMin ?? ageMin(pick(j, 'createdAt'), now))}</td>
                    <td className="adm-num">{cauris(Number(j.cost))}</td>
                    <td><button type="button" className="adm-btn sm danger" onClick={() => openAction(cancelSpec(uid, j, reload))}>Annuler et rembourser</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ——— Recharges ——— */

function TopupsTab({ openAction }) {
  const [status, setStatus] = useState('')
  const [stuck, setStuck] = useState(false)
  const { loading, data, error, reload } = useLoad(() => api.adminTopups({ status, stuck: stuck ? 1 : '' }), [status, stuck])
  const now = Date.now()
  const topups = sortTopups(rows(data, 'topups'), now)
  return (
    <div className="adm-card">
      <div className="adm-bar">
        <label className="adm-field inline">
          <span>Statut</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            {Object.entries(TOPUP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="adm-check"><input type="checkbox" checked={stuck} onChange={(e) => setStuck(e.target.checked)} />Bloquées seulement (+ de 10 min)</label>
        <button type="button" className="adm-btn" onClick={reload} disabled={loading}><Icon name="revert" size={16} />Actualiser</button>
      </div>
      {error && <p className="adm-err" role="alert">{error}</p>}
      {!error && !loading && !topups.length && <p className="adm-note">Aucune recharge.</p>}
      {topups.length > 0 && (
        <div className="adm-tw">
          <table className="adm-table">
            <thead><tr><th>Date</th><th>Compte</th><th>Référence</th><th>Montant</th><th>Statut</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {topups.map((t) => (
                <tr key={t.reference}>
                  <td>{formatDate(pick(t, 'createdAt'))}</td>
                  <td><Link className="adm-link" to={`/admin?t=users&u=${encodeURIComponent(t.account)}`}>{t.email || t.account}</Link><br /><small>{t.operator ?? ''} {t.phone ?? ''}</small></td>
                  <td className="adm-mono">{t.reference}</td>
                  <td className="adm-num">{fcfaOf(t)}<br /><small>{caurisLabel(Number(t.jetons))}</small></td>
                  <td><TopupStatus t={t} now={now} /></td>
                  <td>{canRecheck(t.status) && <button type="button" className="adm-btn sm" onClick={() => openAction(recheckSpec(t.account, t, reload))}>Revérifier</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ——— Fenêtre de confirmation ——— */

/**
 * Confirmation d'une action : motif obligatoire, montant si besoin, puis le compte-rendu du serveur. Une clé d'idempotence par
 * ouverture : réessayer après une coupure renvoie la même clé, et le serveur rend le premier résultat au lieu de refaire l'opération.
 * Après un refus net du serveur (4xx), rien n'a bougé : la clé est renouvelée pour que la saisie corrigée parte comme une nouvelle opération.
 * Après une issue incertaine (réseau, 5xx), les champs sont figés pour que l'essai suivant soit identique.
 */
function ActionDialog({ spec, onClose }) {
  const ref = useRef(null)
  const [key, setKey] = useState(adminKey)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState('credit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [locked, setLocked] = useState(false)
  const [stopped, setStopped] = useState(false) // échec sans issue (rien n'a bougé, réessayer ne changerait rien) : seulement « Fermer »
  const [result, setResult] = useState(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal?.()
  }, [])

  const close = () => {
    if (busy) return
    onClose()
    if (result) spec.onDone?.()
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy || result) return
    const r = checkReason(reason)
    if (r.error) { setError(adminError(r.error)); return }
    let value
    if (spec.amount && !(spec.optional && !amount.trim())) {
      const a = parseAmount(amount, { max: spec.max ?? MAX_ADJUST })
      if (a.error) { setError(adminError(a)); return }
      value = a.amount
    }
    setBusy(true); setError(null)
    try {
      const res = await spec.run({ key, reason: r.reason, amount: value, direction })
      setResult(resultText(spec.action === 'adjust' ? direction : spec.action, res))
    } catch (err) {
      setError(adminError(err))
      const kind = failureKind(err)
      if (kind === 'refused') { setKey(adminKey()); setLocked(false) } else { setLocked(true); setStopped(kind === 'final') }
    } finally { setBusy(false) }
  }

  const frozen = busy || locked || Boolean(result)
  return (
    <dialog ref={ref} className="adm-dlg" aria-labelledby="adm-dlg-t" onCancel={(e) => { e.preventDefault(); close() }}>
      <form onSubmit={submit}>
        <div className="adm-dlg-top">
          <h2 id="adm-dlg-t">{spec.title}</h2>
          <button type="button" className="adm-x" aria-label="Fermer" onClick={close} disabled={busy}><Icon name="close" size={16} /></button>
        </div>
        <div className="adm-dlg-body">
          {spec.intro && <p>{spec.intro}</p>}
          {spec.directions && (
            <div className="adm-seg" role="radiogroup" aria-label="Sens">
              {[['credit', 'Créditer'], ['debit', 'Débiter']].map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={direction === v} disabled={frozen} onClick={() => setDirection(v)}>{l}</button>
              ))}
            </div>
          )}
          {spec.amount && (
            <label className="adm-field">
              <span>Montant en cauris{spec.optional ? ` (vide : ${caurisLabel(spec.max)})` : ''}</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={spec.optional ? String(spec.max) : 'Ex. 50'} disabled={frozen} autoFocus />
            </label>
          )}
          <label className="adm-field">
            <span>Motif (obligatoire)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder="Ex. Génération ratée signalée au support" disabled={frozen} autoFocus={!spec.amount} />
          </label>
          {error && <p className="adm-err" role="alert">{error}</p>}
          {result && <p className="adm-ok" role="status"><Icon name="check" size={16} />{result}</p>}
        </div>
        <div className="adm-dlg-foot">
          {result || stopped
            ? <button type="button" className="adm-btn primary" onClick={close}>Fermer</button>
            : (
              <>
                <button type="button" className="adm-btn" onClick={close} disabled={busy}>Annuler</button>
                <button type="submit" className={`adm-btn ${spec.danger ? 'danger solid' : 'primary'}`} disabled={busy}>{busy ? 'Envoi…' : locked ? 'Réessayer' : spec.confirm}</button>
              </>
            )}
        </div>
      </form>
    </dialog>
  )
}
