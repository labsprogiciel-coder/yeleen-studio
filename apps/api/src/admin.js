import { Hono } from 'hono'
import { STORING, advanceJob, isActive } from './jobs.js'
import { ledgerOf } from './mirror.js'
import { OPEN_STATUSES, recheckTopup, topupView } from './topups.js'

/**
 * Administration du studio (`/admin/*`) : retrouver un utilisateur, corriger son solde, rembourser ou annuler une génération,
 * revérifier une recharge, bloquer un compte. Réservée aux comptes Clerk listés dans ADMIN_USER_IDS (variable réglée dans le tableau
 * de bord Cloudflare, jamais dans wrangler.jsonc) ; vide ou absente : personne. La garde est dans index.js, après celle de la connexion.
 *
 * L'argent et le blocage se décident dans le Durable Object du compte VISÉ (jamais celui de l'administrateur), en une requête ; D1 sert
 * aux listes et à la recherche, et garde le journal `admin_actions`. Chaque action porte une clé du client (« adm_<uuid> ») : rejouée,
 * elle rend le premier résultat ; un motif est obligatoire. Une panne de D1 après l'action ne la défait pas (elle est journalisée).
 */
export const admins = (env) => (env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
/** L'appelant est-il administrateur ? En local sans Clerk (compte `demo`), seulement si `demo` est listé. */
export const isAdmin = (c) => {
  const uid = c.get('uid')
  return typeof uid === 'string' && admins(c.env).includes(uid)
}

const UID = /^[\w-]{3,100}$/
const KEY = /^adm_[\w-]{8,80}$/
const JOB_ID = /^[\w-]{3,100}$/
const REFERENCE = /^[\w-]{3,64}$/
const STUCK_TOPUP = 10 * 60_000 // une recharge ouverte depuis plus longtemps est « bloquée »
const STUCK_JOB = 30 * 60_000 // de même pour une génération

/** Motif : obligatoire, 3 à 300 caractères après nettoyage. */
export const cleanReason = (v) => {
  const r = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : ''
  return r.length >= 3 && r.length <= 300 ? r : null
}
/** Montant en jetons : fini, positif, une décimale au plus, sous le plafond. */
export const validAmount = (v, max) => typeof v === 'number' && Number.isFinite(v) && v > 0 && Math.round(v * 10) / 10 === v && v <= max
const maxAdjust = (env) => Number(env.ADMIN_MAX_ADJUST ?? 10000)
const minutes = (ms) => Math.floor(ms / 60_000)
const parse = (v) => { try { return v == null ? null : JSON.parse(v) } catch { return null } }

/**
 * `accountStub(env, uid)` : le Durable Object d'un compte ; `paygate(env)` : le client paygate ou null ; `providerCancel(env, job)` :
 * annulation chez le fournisseur, sans garantie. Fournis par index.js.
 */
export function adminApp({ accountStub, paygate, providerCancel }) {
  const a = new Hono()
  // D1 obligatoire : il dit si le compte visé existe (sinon, l'appeler créerait son Durable Object, voire un portefeuille).
  a.use('*', async (c, next) => (c.env.DB ? next() : c.json({ error: 'db_unavailable' }, 503)))

  /** Appels POST JSON (ou GET sans corps) au Durable Object du compte visé ; rend { status, body }. */
  const acctOf = (env, uid) => {
    const stub = accountStub(env, uid)
    return async (path, body) => {
      const res = await stub.fetch(`https://account${path}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })
      return { status: res.status, body: await res.json() }
    }
  }
  /** Compte visé : identifiant valide et ligne dans D1, sinon la réponse d'erreur. */
  const target = async (c) => {
    const uid = c.req.param('uid')
    if (!UID.test(uid ?? '')) return { error: c.json({ error: 'invalid_user' }, 400) }
    const user = await c.env.DB.prepare('SELECT u.id, email, name, country, created_at AS createdAt, last_seen_at AS lastSeenAt, welcomed_at AS welcomedAt, b.blocked_at AS blockedAt, b.reason AS blockedReason FROM users u LEFT JOIN user_blocks b ON b.user_id = u.id WHERE u.id = ?1').bind(uid).first()
    if (!user) return { error: c.json({ error: 'not_found' }, 404) }
    return { uid, user, acct: acctOf(c.env, uid) }
  }

  /**
   * Corps d'une action : clé et motif obligatoires. Une clé déjà notée rend son premier résultat (`replayed`) si c'est la même action
   * (même compte, même nature, même objet, même montant si `amount` est donné), sinon un conflit. Rend { key, reason, replay? } ou { error }.
   */
  const begin = async (c, uid, { action, ref = null, amount, body }) => {
    if (typeof body.key !== 'string' || !KEY.test(body.key)) return { error: c.json({ error: 'invalid_key' }, 400) }
    const reason = cleanReason(body.reason)
    if (!reason) return { error: c.json({ error: 'invalid_reason', min: 3, max: 300 }, 400) }
    try {
      const prev = await c.env.DB.prepare('SELECT target, action, ref, amount, result FROM admin_actions WHERE id = ?1').bind(body.key).first()
      if (prev) {
        // Un remboursement note dans `amount` ce qui a été rendu ; le montant demandé (comparé ici) est gardé dans le résultat.
        const kept = parse(prev.result)
        const asked = kept && typeof kept === 'object' && 'requested' in kept ? kept.requested : prev.amount ?? null
        const same = prev.target === uid && prev.action === action && (prev.ref ?? null) === ref && (amount === undefined || asked === amount)
        return { error: same ? c.json({ ...parse(prev.result), replayed: true }) : c.json({ error: 'key_conflict' }, 409) }
      }
    } catch (e) {
      console.error('administration : lecture du journal (D1)', e.message) // le Durable Object reste idempotent par lui-même
    }
    return { key: body.key, reason }
  }
  /** Note l'action réussie dans `admin_actions` ; une panne de D1 ne défait rien, elle est journalisée. */
  const log = async (c, { key, uid, action, ref = null, amount = null, reason, result }) => {
    try {
      await c.env.DB.prepare('INSERT OR IGNORE INTO admin_actions (id, at, actor, target, action, ref, amount, reason, result) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
        .bind(key, Date.now(), c.get('uid'), uid, action, ref, amount, reason, JSON.stringify(result)).run()
    } catch (e) {
      console.error('administration : journal non écrit (D1)', key, action, uid, e.message)
    }
  }
  const body = (c) => c.req.json().then((b) => (b && typeof b === 'object' ? b : {}), () => ({}))
  const topupAdmin = (t) => ({ ...topupView(t), country: t.country ?? null, paygateId: t.paygateId ?? null, mismatch: t.mismatch ?? null, checkedAt: t.checkedAt ?? null, completedAt: t.completedAt ?? null })

  a.get('/me', (c) => c.json({ admin: true, uid: c.get('uid') }))

  // Recherche : identifiant exact, e-mail (morceau, sans casse), numéro d'une recharge, référence de recharge ou identifiant de génération.
  a.get('/users', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 200)
    const cols = 'u.id, u.email, u.name, u.country, u.created_at AS createdAt, u.last_seen_at AS lastSeenAt, b.blocked_at AS blockedAt'
    const db = c.env.DB
    let rows
    if (!q) ({ results: rows } = await db.prepare(`SELECT ${cols} FROM users u LEFT JOIN user_blocks b ON b.user_id = u.id ORDER BY u.created_at DESC LIMIT ?1`).bind(50).all())
    else {
      const like = `%${q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`
      const digits = q.replace(/\D/g, '')
      ;({ results: rows } = await db.prepare(`SELECT ${cols} FROM users u LEFT JOIN user_blocks b ON b.user_id = u.id WHERE u.id = ?1 OR lower(u.email) LIKE ?2 ESCAPE '\\'
        OR u.id IN (SELECT account FROM topups WHERE reference = ?1 OR phone = ?1 OR (?3 IS NOT NULL AND phone LIKE ?3))
        OR u.id IN (SELECT user_id FROM jobs WHERE id = ?1)
        ORDER BY u.created_at DESC LIMIT 50`).bind(q, like, digits.length >= 8 ? `%${digits}` : null).all())
    }
    return c.json({ users: rows })
  })

  // Fiche d'un utilisateur : profil (D1), solde et blocage (Durable Object), recharges (Durable Object), générations, grand livre, actions.
  a.get('/users/:uid', async (c) => {
    const t = await target(c)
    if (t.error) return t.error
    const db = c.env.DB
    const [state, topups, jobs, ledger, actions] = await Promise.all([
      t.acct('/admin/state'),
      t.acct('/topup/list?limit=200'),
      db.prepare('SELECT id, kind, model_id AS modelId, status, cost, count, prompt, failure, refund, outputs, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt FROM jobs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100').bind(t.uid).all(),
      ledgerOf(db, t.uid, { limit: 200 }),
      db.prepare('SELECT id, at, actor, action, ref, amount, reason, result FROM admin_actions WHERE target = ?1 ORDER BY at DESC LIMIT 100').bind(t.uid).all(),
    ])
    return c.json({
      user: t.user, balance: state.body.balance, blocked: state.body.blocked,
      topups: topups.body.map(topupAdmin),
      jobs: jobs.results.map((j) => ({ ...j, outputs: parse(j.outputs) ?? [] })),
      ledger,
      actions: actions.results.map((x) => ({ ...x, result: parse(x.result) })),
    })
  })

  // Ajustement du solde à la main (crédit ou débit), avec motif ; jamais sous 0.
  a.post('/users/:uid/adjust', async (c) => {
    const t = await target(c)
    if (t.error) return t.error
    const b = await body(c)
    if (b.direction !== 'credit' && b.direction !== 'debit') return c.json({ error: 'invalid_direction' }, 400)
    if (!validAmount(b.amount, maxAdjust(c.env))) return c.json({ error: 'invalid_amount', max: maxAdjust(c.env) }, 400)
    const s = await begin(c, t.uid, { action: b.direction, amount: b.amount, body: b })
    if (s.error) return s.error
    const r = await t.acct('/admin/adjust', { key: s.key, direction: b.direction, amount: b.amount, reason: s.reason, actor: c.get('uid') })
    if (!r.body.ok) return c.json(r.body, r.status) // insufficient (402), key_conflict (409)
    const { replayed, ...result } = r.body
    await log(c, { key: s.key, uid: t.uid, action: b.direction, amount: b.amount, reason: s.reason, result }) // sans effet si déjà noté
    return c.json(r.body)
  })

  // Remboursement d'une génération terminée : tout (par défaut) ou une partie, une seule fois.
  a.post('/users/:uid/jobs/:jobId/refund', async (c) => {
    const t = await target(c)
    if (t.error) return t.error
    const jobId = c.req.param('jobId')
    if (!JOB_ID.test(jobId)) return c.json({ error: 'not_found' }, 404)
    const b = await body(c)
    if (b.amount != null && !validAmount(b.amount, maxAdjust(c.env))) return c.json({ error: 'invalid_amount', max: maxAdjust(c.env) }, 400)
    const s = await begin(c, t.uid, { action: 'refund_job', ref: jobId, amount: b.amount ?? null, body: b })
    if (s.error) return s.error
    // La clé va au Durable Object : rejouée sans ligne dans D1 (panne du journal), il rend le premier résultat (`replayed`).
    const r = await t.acct('/job/refund', { jobId, amount: b.amount ?? undefined, reason: s.reason, actor: c.get('uid'), key: s.key })
    if (!r.body.ok) return c.json(r.body, r.status) // not_found, job_active, no_debit, already_refunded, key_conflict
    const { replayed, ...result } = r.body
    // `amount` : ce qui a vraiment été rendu (plafonné au débit) ; le montant demandé reste dans le résultat, pour la comparaison d'une clé rejouée.
    await log(c, { key: s.key, uid: t.uid, action: 'refund_job', ref: jobId, amount: result.refunded, reason: s.reason, result: { ...result, requested: b.amount ?? null } })
    return c.json(r.body)
  })

  /**
   * Annulation d'une génération active (bloquée) : on la fait d'abord avancer comme le webhook ou le suivi, pour qu'une génération en
   * fait terminée chez le fournisseur se termine avec ses fichiers ; encore active, on l'annule chez le fournisseur (sans garantie),
   * puis le Durable Object la passe CANCELED et rend ce qui reste du débit.
   */
  a.post('/users/:uid/jobs/:jobId/cancel', async (c) => {
    const t = await target(c)
    if (t.error) return t.error
    const jobId = c.req.param('jobId')
    if (!JOB_ID.test(jobId)) return c.json({ error: 'not_found' }, 404)
    const b = await body(c)
    const s = await begin(c, t.uid, { action: 'cancel_job', ref: jobId, body: b })
    if (s.error) return s.error
    // Clé déjà traitée mais absente de D1 (panne du journal) : le Durable Object a gardé le premier résultat.
    const seen = (await t.acct('/admin/kept', { key: s.key })).body
    if (seen) {
      if (seen.action !== 'cancel_job' || seen.ref !== jobId) return c.json({ error: 'key_conflict' }, 409)
      await log(c, { key: s.key, uid: t.uid, action: 'cancel_job', ref: jobId, amount: seen.result.outcome === 'canceled' ? seen.result.refunded : null, reason: s.reason, result: seen.result })
      return c.json({ ...seen.result, replayed: true })
    }
    const getJob = async () => (await t.acct(`/job/get?id=${encodeURIComponent(jobId)}`)).body
    let job = await getJob()
    if (!job) return c.json({ error: 'not_found' }, 404)
    if (!isActive(job)) return c.json({ error: 'not_active', status: job.status }, 409)
    const acct = async (path, payload) => (await t.acct(path, payload)).body
    try {
      await advanceJob({ env: c.env, acct, accountId: t.uid, origin: job.origin ?? new URL(c.req.url).origin, job })
    } catch (e) {
      console.error('administration : suivi avant annulation', job.provider ?? 'fal', e.message)
    }
    job = (await getJob()) ?? job
    let result
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      // Terminée chez le fournisseur pendant ce suivi : rien à annuler (un échec a déjà été remboursé).
      result = { outcome: job.status === 'COMPLETED' ? 'completed' : 'failed', job, refunded: job.status === 'FAILED' ? job.refund ?? 0 : 0, balance: (await t.acct('/admin/state')).body.balance }
      await t.acct('/admin/kept', { key: s.key, entry: { action: 'cancel_job', ref: jobId, result } })
    } else {
      // Terminée chez le fournisseur, ses fichiers sont en cours de copie ailleurs : elle va se terminer, on ne l'annule pas.
      if (job.storingAt && Date.now() - job.storingAt < STORING) return c.json({ error: 'storing', status: job.status }, 409)
      if (isActive(job)) await providerCancel(c.env, job)
      const r = await t.acct('/job/cancel', { jobId, reason: s.reason, actor: c.get('uid'), key: s.key })
      if (!r.body.ok) return c.json(r.body, r.status)
      result = { outcome: 'canceled', job: r.body.job, refunded: r.body.refunded, balance: r.body.balance }
    }
    // `amount` : ce que l'annulation a rendu (un échec constaté pendant le suivi a été remboursé par le suivi, pas par l'annulation).
    await log(c, { key: s.key, uid: t.uid, action: 'cancel_job', ref: jobId, amount: result.outcome === 'canceled' ? result.refunded : null, reason: s.reason, result })
    return c.json(result)
  })

  // Blocage ou déblocage du compte (fait foi dans le Durable Object, copié dans D1 (`user_blocks`) pour les listes).
  a.post('/users/:uid/block', async (c) => {
    const t = await target(c)
    if (t.error) return t.error
    const b = await body(c)
    if (typeof b.blocked !== 'boolean') return c.json({ error: 'invalid_blocked' }, 400)
    const action = b.blocked ? 'block' : 'unblock'
    const s = await begin(c, t.uid, { action, body: b })
    if (s.error) return s.error
    const r = await t.acct('/admin/block', { blocked: b.blocked, reason: s.reason, actor: c.get('uid'), key: s.key })
    if (!r.body.ok) return c.json(r.body, r.status) // key_conflict
    try {
      const db = c.env.DB
      await (r.body.blocked
        ? db.prepare('INSERT INTO user_blocks (user_id, blocked_at, reason, actor) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id) DO UPDATE SET blocked_at = excluded.blocked_at, reason = excluded.reason, actor = excluded.actor')
          .bind(t.uid, r.body.blocked.at, s.reason, c.get('uid'))
        : db.prepare('DELETE FROM user_blocks WHERE user_id = ?1').bind(t.uid)).run()
    } catch (e) {
      console.error('administration : blocage non copié (D1)', t.uid, e.message)
    }
    const { replayed, ...result } = r.body
    await log(c, { key: s.key, uid: t.uid, action, reason: s.reason, result })
    return c.json(r.body)
  })

  // Recharges de tous les comptes (D1), les plus récentes d'abord ; `status`, `stuck=1` (ouvertes depuis plus de 10 min), `limit` (200 au plus).
  a.get('/topups', async (c) => {
    const { status, stuck, limit } = c.req.query()
    if (status && !/^[a-z_]{3,20}$/.test(status)) return c.json({ error: 'invalid_status' }, 400)
    const n = Math.min(Math.max(Number(limit) || 100, 1), 200)
    const now = Date.now()
    const open = OPEN_STATUSES.map((x) => `'${x}'`).join(', ')
    const { results } = await c.env.DB.prepare(`SELECT t.reference, t.account, u.email, t.pack, t.amount_fcfa AS amountFcfa, t.jetons, t.country, t.operator, t.phone,
        t.status, t.failure, t.late, t.paygate_id AS paygateId, t.created_at AS createdAt, t.updated_at AS updatedAt, t.completed_at AS completedAt
      FROM topups t LEFT JOIN users u ON u.id = t.account
      WHERE (?1 IS NULL OR t.status = ?1) AND (?2 = 0 OR (t.status IN (${open}) AND t.created_at < ?3))
      ORDER BY t.created_at DESC LIMIT ?4`).bind(status || null, stuck === '1' ? 1 : 0, now - STUCK_TOPUP, n).all()
    return c.json({
      topups: results.map((t) => ({ ...t, late: Boolean(t.late), ageMin: minutes(now - t.createdAt), stuck: OPEN_STATUSES.includes(t.status) && now - t.createdAt > STUCK_TOPUP })),
    })
  })

  // Revérification d'une recharge chez paygate, puis le chemin habituel du compte visé (crédit idempotent par référence).
  a.post('/users/:uid/topups/:reference/recheck', async (c) => {
    const t = await target(c)
    if (t.error) return t.error
    const pg = paygate(c.env)
    if (!pg) return c.json({ error: 'payments_not_configured' }, 503)
    const reference = c.req.param('reference')
    if (!REFERENCE.test(reference)) return c.json({ error: 'not_found' }, 404)
    const b = await body(c)
    const s = await begin(c, t.uid, { action: 'recheck_topup', ref: reference, body: { reason: 'Revérification paygate', ...b } })
    if (s.error) return s.error
    const topup = (await t.acct(`/topup/get?ref=${encodeURIComponent(reference)}`)).body
    if (!topup) return c.json({ error: 'not_found' }, 404)
    if (topup.status === 'completed') return c.json({ error: 'already_completed', topup: topupAdmin(topup) }, 409)
    const acct = async (path, payload) => (await t.acct(path, payload)).body
    const out = await recheckTopup({ pg, acct, topup, from: ['pending', 'processing', 'awaiting_code', 'failed', 'expired'] })
    const fresh = (await t.acct(`/topup/get?ref=${encodeURIComponent(reference)}`)).body ?? out.topup
    const result = { topup: topupAdmin(fresh), credited: out.credited, mismatch: out.mismatch, balance: (await t.acct('/admin/state')).body.balance, ...(out.error ? { error: out.error } : {}) }
    if (out.error) return c.json(result, 502) // paygate n'a pas répondu : rien n'est noté, on peut réessayer avec la même clé
    await log(c, { key: s.key, uid: t.uid, action: 'recheck_topup', ref: reference, amount: out.credited || null, reason: s.reason, result })
    return c.json(result)
  })

  // Générations en cours de tous les comptes (D1) ; `scope=stuck` : seulement celles lancées depuis plus de 30 min.
  a.get('/jobs', async (c) => {
    const stuck = c.req.query('scope') === 'stuck'
    const now = Date.now()
    const { results } = await c.env.DB.prepare(`SELECT j.id, j.user_id AS userId, u.email, j.kind, j.model_id AS modelId, j.status, j.cost, j.prompt,
        j.created_at AS createdAt, j.started_at AS startedAt
      FROM jobs j LEFT JOIN users u ON u.id = j.user_id
      WHERE j.status IN ('IN_QUEUE', 'IN_PROGRESS') AND (?1 = 0 OR j.created_at < ?2)
      ORDER BY j.created_at DESC LIMIT 200`).bind(stuck ? 1 : 0, now - STUCK_JOB).all()
    return c.json({ jobs: results.map((j) => ({ ...j, ageMin: minutes(now - j.createdAt), stuck: now - j.createdAt > STUCK_JOB })) })
  })

  return a
}
