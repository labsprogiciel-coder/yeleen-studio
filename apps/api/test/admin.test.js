import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account-do.js'
import { advanceJob } from '../src/jobs.js'
import { resetAuthCache } from '../src/auth.js'
import app from '../src/index.js'
import { signBody } from '../src/paygate.js'
import { resetUserCache } from '../src/users.js'
import { testD1 } from './d1.js'

beforeEach(() => resetUserCache())

const ISSUER = 'https://clerk.example.test'
const ORIGIN = 'https://yeleen.example.workers.dev'
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** Clés RSA de test et de quoi signer des jetons comme Clerk. */
async function keys() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  const sign = async (claims) => {
    const now = Math.floor(Date.now() / 1000)
    const head = enc({ alg: 'RS256', typ: 'JWT', kid: 'k1' })
    const body = enc({ iss: ISSUER, azp: ORIGIN, iat: now, nbf: now - 1, exp: now + 600, ...claims })
    const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`))).toString('base64url')
    return `${head}.${body}.${sig}`
  }
  return { jwks: { keys: [jwk] }, sign }
}
const K = await keys()

/**
 * L'API entière : plusieurs comptes (un vrai Account par compte, stockage en mémoire), une vraie base D1 (SQLite), de faux fal et paygate.
 * `t.fal` : état rendu par fal ; `t.pg` : paiements connus de paygate (référence → paiement).
 */
function setup(vars = {}) {
  const db = testD1()
  const stores = new Map()
  const accounts = new Map()
  const account = (name) => {
    if (!accounts.has(name)) {
      const m = new Map(); stores.set(name, m)
      accounts.set(name, new Account({ storage: { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)) } } }, { ENV: 'dev', DB: db }))
    }
    return accounts.get(name)
  }
  const env = {
    FAL_KEY: 'test', ENV: 'production', CLERK_ISSUER: ISSUER, ALLOWED_ORIGINS: ORIGIN, DB: db, ADMIN_USER_IDS: 'user_admin, user_other_admin',
    PAYGATE_URL: 'https://paygate.test', PAYGATE_KEY: 'pgk', PAYGATE_WEBHOOK_SECRET: 'whsec', ...vars,
    ACCOUNT: { idFromName: (n) => n, get: (name) => ({ fetch: (url, init) => account(name).fetch(new Request(url, init)) }) },
  }
  const t = { db, stores, account, fal: 'IN_QUEUE', pg: {}, cancels: [], claims: {} } // `claims` : champs en plus du jeton, par compte
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    if (u.endsWith('/.well-known/jwks.json')) return Response.json(K.jwks)
    if (u.endsWith('/nano-banana-pro')) return Response.json({ request_id: 'r1', status_url: 'https://queue.fal.run/x/requests/r1/status', response_url: 'https://queue.fal.run/x/requests/r1', cancel_url: 'https://queue.fal.run/x/requests/r1/cancel' })
    if (u.includes('/status')) return t.fal === 'DOWN' ? Response.json({ detail: 'panne' }, { status: 503 }) : Response.json({ status: t.fal, queue_position: 1 }) // 'DOWN' : état illisible
    if (u.endsWith('/cancel')) { t.cancels.push(u); await t.onCancel?.(); return Response.json({ status: 'CANCELLATION_REQUESTED' }) }
    if (u === 'https://queue.fal.run/x/requests/r1') return Response.json({ images: [{ url: 'https://fal.media/chat.png', content_type: 'image/png' }] })
    if (u.endsWith('/v1/collections')) return Response.json({ id: 'pg1', reference: body.reference, status: 'processing', amount: body.amount, currency: 'XOF', metadata: body.metadata }, { status: 201 })
    const ref = /\/v1\/collections\/([\w-]+)$/.exec(u)?.[1]
    if (ref) return t.pg[ref] ? Response.json(t.pg[ref]) : Response.json({ error: { code: 'not_found' } }, { status: 404 })
    return Response.json({ detail: 'inattendu' }, { status: 500 })
  }
  resetAuthCache()
  resetUserCache() // nouvelle base : chaque utilisateur doit y être recréé
  const tokens = {}
  t.as = async (sub, path, init = {}) => {
    tokens[sub] ??= await K.sign({ sub, email: `${sub.replace('user_', '')}@example.test`, ...(t.claims[sub] ?? {}) })
    const res = await app.fetch(new Request(`http://api${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${tokens[sub]}` } }), env)
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* texte */ }
    return { status: res.status, body: json }
  }
  t.admin = (path, init) => t.as('user_admin', path, init)
  t.rows = (sql, ...args) => db.raw.prepare(sql).all(...args)
  t.restore = () => { globalThis.fetch = real }
  return t
}
const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const image = { kind: 'image', modelId: 'nano-banana-pro', prompt: 'un chat', resolution: '1K', count: 1 }
let n = 0
const key = () => `adm_${crypto.randomUUID()}${n++}`
const topupReq = { pack: 'createur', country: 'BF', operator: 'moov', phone: '70123456' }

test('administration : réservée à ADMIN_USER_IDS (403 sinon), liste vide = personne, sans connexion 401', async () => {
  const t = setup()
  try {
    assert.equal((await t.as('user_alice', '/wallet')).status, 200)
    for (const [path, init] of [['/admin/me'], ['/admin/users'], ['/admin/users/user_alice'], ['/admin/topups'], ['/admin/jobs'], ['/admin/users/user_alice/adjust', post({ key: key(), direction: 'credit', amount: 10, reason: 'geste' })]]) {
      const r = await t.as('user_alice', path, init)
      assert.equal(r.status, 403, path)
      assert.equal(r.body.error, 'forbidden')
    }
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240) // rien n'a été crédité
    const me = await t.admin('/admin/me')
    assert.deepEqual([me.status, me.body], [200, { admin: true, uid: 'user_admin' }])
    assert.equal((await t.as('user_other_admin', '/admin/me')).status, 200) // liste séparée par des virgules, espaces ignorés
    const anon = await app.fetch(new Request('http://api/admin/me'), { ENV: 'production', CLERK_ISSUER: ISSUER, ALLOWED_ORIGINS: ORIGIN, ADMIN_USER_IDS: 'user_admin' })
    assert.equal(anon.status, 401)
  } finally { t.restore() }
  for (const ADMIN_USER_IDS of ['', ' , ', undefined]) {
    const e = setup({ ADMIN_USER_IDS })
    try {
      assert.equal((await e.admin('/admin/me')).status, 403)
    } finally { e.restore() }
  }
})

test('administration : en local sans Clerk, `demo` n\'est administrateur que s\'il est listé', async () => {
  const db = testD1()
  const acct = new Account({ storage: { get: async () => undefined, put: async () => {} } }, { ENV: 'dev' })
  const env = (ADMIN_USER_IDS) => ({ ENV: 'dev', DB: db, ADMIN_USER_IDS, ACCOUNT: { idFromName: (x) => x, get: () => ({ fetch: (u, i) => acct.fetch(new Request(u, i)) }) } })
  assert.equal((await app.fetch(new Request('http://api/admin/me'), env(''))).status, 403)
  assert.equal((await app.fetch(new Request('http://api/admin/me'), env('user_admin'))).status, 403)
  assert.equal((await app.fetch(new Request('http://api/admin/me'), env('demo'))).status, 200)
})

test('administration : recherche par identifiant, e-mail, numéro, génération ; sans texte, les plus récents ; compte inconnu 404', async () => {
  const t = setup()
  try {
    await t.as('user_alice', '/wallet')
    await t.as('user_bob', '/wallet')
    const recent = await t.admin('/admin/users')
    assert.deepEqual(recent.body.users.map((u) => u.id).sort(), ['user_admin', 'user_alice', 'user_bob'])
    assert.deepEqual(Object.keys(recent.body.users[0]).sort(), ['avatarUrl', 'blockedAt', 'country', 'createdAt', 'email', 'id', 'lastSeenAt', 'name'])
    assert.deepEqual((await t.admin('/admin/users?q=user_bob')).body.users.map((u) => u.id), ['user_bob'])
    assert.deepEqual((await t.admin('/admin/users?q=ALICE@EXAMPLE')).body.users.map((u) => u.id), ['user_alice'])
    assert.deepEqual((await t.admin('/admin/users?q=%25')).body.users, []) // % et _ sont pris à la lettre
    await t.as('user_bob', '/topups', post(topupReq))
    assert.deepEqual((await t.admin('/admin/users?q=70123456')).body.users.map((u) => u.id), ['user_bob'])
    const job = await t.as('user_alice', '/jobs', post(image))
    assert.deepEqual((await t.admin(`/admin/users?q=${job.body.jobId}`)).body.users.map((u) => u.id), ['user_alice'])

    assert.equal((await t.admin('/admin/users/user_inconnu')).status, 404)
    assert.equal(t.stores.has('user_inconnu'), false) // son Durable Object n'a pas été touché
    assert.equal((await t.admin('/admin/users/a%20b')).status, 400)
    const page = await t.admin('/admin/users/user_alice')
    assert.equal(page.status, 200)
    assert.equal(page.body.user.id, 'user_alice')
    assert.equal(page.body.balance, 240 - job.body.cost)
    assert.equal(page.body.blocked, null)
    assert.equal(page.body.jobs[0].id, job.body.jobId)
    assert.ok(page.body.ledger.some((l) => l.kind === 'debit' && l.ref === job.body.jobId))
    assert.deepEqual([page.body.topups, page.body.actions], [[], []])
  } finally { t.restore() }
})

test('ajustement : crédit et débit sur le compte visé, journal ; clé rejouée = même résultat, autre montant = conflit', async () => {
  const t = setup()
  try {
    await t.as('user_alice', '/wallet')
    const adminStart = (await t.admin('/wallet')).body.balance
    const k = key()
    const ok = await t.admin('/admin/users/user_alice/adjust', post({ key: k, direction: 'credit', amount: 50.5, reason: '  Geste commercial  ' }))
    assert.equal(ok.status, 200)
    assert.deepEqual([ok.body.ok, ok.body.balance], [true, 290.5])
    const again = await t.admin('/admin/users/user_alice/adjust', post({ key: k, direction: 'credit', amount: 50.5, reason: 'Geste commercial' }))
    assert.deepEqual([again.status, again.body.balance, again.body.replayed], [200, 290.5, true])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 290.5) // une seule fois
    assert.equal((await t.admin('/wallet')).body.balance, adminStart) // jamais le portefeuille de l'administrateur
    const conflict = await t.admin('/admin/users/user_alice/adjust', post({ key: k, direction: 'credit', amount: 60, reason: 'Geste commercial' }))
    assert.deepEqual([conflict.status, conflict.body.error], [409, 'key_conflict'])
    assert.equal((await t.admin('/admin/users/user_alice/adjust', post({ key: k, direction: 'debit', amount: 50.5, reason: 'Geste commercial' }))).body.error, 'key_conflict')

    const d = await t.admin('/admin/users/user_alice/adjust', post({ key: key(), direction: 'debit', amount: 90.5, reason: 'Erreur de crédit' }))
    assert.equal(d.body.balance, 200)
    const tooMuch = await t.admin('/admin/users/user_alice/adjust', post({ key: key(), direction: 'debit', amount: 500, reason: 'Erreur de crédit' }))
    assert.deepEqual([tooMuch.status, tooMuch.body.error], [402, 'insufficient']) // jamais sous 0
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 200)

    const ledger = t.rows("SELECT kind, ref, delta, balance FROM ledger WHERE account = 'user_alice' AND ref LIKE 'adm_%' ORDER BY at")
    assert.deepEqual(ledger.map((l) => [l.kind, l.delta, l.balance]), [['credit', 50.5, 290.5], ['debit', -90.5, 200]])
    const log = t.rows("SELECT id, actor, target, action, amount, reason FROM admin_actions WHERE result IS NOT NULL ORDER BY at") // les clés refusées restent réservées, sans résultat
    assert.deepEqual(log.map((l) => [l.actor, l.target, l.action, l.amount, l.reason]), [['user_admin', 'user_alice', 'credit', 50.5, 'Geste commercial'], ['user_admin', 'user_alice', 'debit', 90.5, 'Erreur de crédit']])
    assert.equal(log[0].id, k)
  } finally { t.restore() }
})

test('ajustement refusé : clé, motif, sens, montant (zéro, négatif, deux décimales, plafond, texte)', async () => {
  const t = setup({ ADMIN_MAX_ADJUST: '1000' })
  try {
    await t.as('user_alice', '/wallet')
    const adjust = (b) => t.admin('/admin/users/user_alice/adjust', post({ key: key(), direction: 'credit', amount: 10, reason: 'Geste commercial', ...b }))
    for (const [b, error] of [
      [{ key: 'pas-une-cle' }, 'invalid_key'], [{ key: undefined }, 'invalid_key'],
      [{ reason: '' }, 'invalid_reason'], [{ reason: '  a  ' }, 'invalid_reason'], [{ reason: 'x'.repeat(301) }, 'invalid_reason'], [{ reason: undefined }, 'invalid_reason'],
      [{ direction: 'gift' }, 'invalid_direction'],
      [{ amount: 0 }, 'invalid_amount'], [{ amount: -5 }, 'invalid_amount'], [{ amount: 1.25 }, 'invalid_amount'], [{ amount: 1001 }, 'invalid_amount'], [{ amount: '10' }, 'invalid_amount'], [{ amount: null }, 'invalid_amount'],
    ]) {
      const r = await adjust(b)
      assert.deepEqual([r.status, r.body.error], [400, error], JSON.stringify(b))
    }
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240)
    assert.equal(t.rows('SELECT * FROM admin_actions').length, 0)
    assert.equal((await t.admin('/admin/users/user_personne/adjust', post({ key: key(), direction: 'credit', amount: 10, reason: 'Geste commercial' }))).status, 404)
  } finally { t.restore() }
})

test('remboursement d\'une génération terminée : partiel, une seule fois ; rejoué, le premier résultat ; active : refusé', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const id = job.body.jobId
    const active = await t.admin(`/admin/users/user_alice/jobs/${id}/refund`, post({ key: key(), reason: 'Résultat raté' }))
    assert.deepEqual([active.status, active.body.error], [409, 'job_active']) // une génération active s'annule (voir plus bas)
    t.fal = 'COMPLETED'
    assert.equal((await t.as('user_alice', `/jobs/${id}`)).body.status, 'COMPLETED')
    const k = key()
    const r = await t.admin(`/admin/users/user_alice/jobs/${id}/refund`, post({ key: k, amount: 2, reason: 'Résultat raté' }))
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.refunded, r.body.balance, r.body.job.refund, r.body.job.status], [2, 240 - job.body.cost + 2, 2, 'COMPLETED'])
    const replay = await t.admin(`/admin/users/user_alice/jobs/${id}/refund`, post({ key: k, amount: 2, reason: 'Résultat raté' }))
    assert.deepEqual([replay.status, replay.body.refunded, replay.body.replayed], [200, 2, true])
    const twice = await t.admin(`/admin/users/user_alice/jobs/${id}/refund`, post({ key: key(), reason: 'Encore' }))
    assert.deepEqual([twice.status, twice.body.error, twice.body.refunded], [409, 'already_refunded', 2])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240 - job.body.cost + 2)
    assert.equal(t.rows("SELECT refund FROM jobs WHERE id = ?", id)[0].refund, 2) // D1 suit le Durable Object
    assert.equal(t.rows("SELECT delta FROM ledger WHERE kind = 'refund' AND ref = ?", id)[0].delta, 2)
    assert.equal(t.rows("SELECT action, ref, amount FROM admin_actions WHERE action = 'refund_job' AND result IS NOT NULL").length, 1)
    assert.equal((await t.admin('/admin/users/user_alice/jobs/inconnue/refund', post({ key: key(), reason: 'Résultat raté' }))).status, 404)
    // Plus que le débit : plafonné au débit (une autre génération).
    t.fal = 'IN_QUEUE'
    const other = await t.as('user_alice', '/jobs', post(image))
    t.fal = 'COMPLETED'
    await t.as('user_alice', `/jobs/${other.body.jobId}`)
    const capped = await t.admin(`/admin/users/user_alice/jobs/${other.body.jobId}/refund`, post({ key: key(), amount: 999, reason: 'Résultat raté' }))
    assert.equal(capped.body.refunded, other.body.cost)
  } finally { t.restore() }
})

test('annulation par l\'administration : active → CANCELED et remboursée, place libérée ; terminée → refusée ; un suivi en retard n\'écrase rien', async () => {
  const t = setup({ MAX_ACTIVE_JOBS: '1' })
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const id = job.body.jobId
    assert.equal((await t.as('user_alice', '/jobs', post(image))).status, 429) // une seule place
    const k = key()
    const r = await t.admin(`/admin/users/user_alice/jobs/${id}/cancel`, post({ key: k, reason: 'Bloquée chez fal' }))
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.outcome, r.body.refunded, r.body.balance, r.body.job.status, r.body.job.failure], ['canceled', job.body.cost, 240, 'CANCELED', 'admin_cancel'])
    assert.equal(t.cancels.length, 1) // annulée chez fal aussi
    assert.equal(t.rows('SELECT status FROM jobs WHERE id = ?', id)[0].status, 'CANCELED')
    const replay = await t.admin(`/admin/users/user_alice/jobs/${id}/cancel`, post({ key: k, reason: 'Bloquée chez fal' }))
    assert.deepEqual([replay.status, replay.body.outcome, replay.body.replayed], [200, 'canceled', true])
    const again = await t.admin(`/admin/users/user_alice/jobs/${id}/cancel`, post({ key: key(), reason: 'Bloquée chez fal' }))
    assert.deepEqual([again.status, again.body.error, again.body.status], [409, 'not_active', 'CANCELED'])
    // fal termine en retard : le suivi ne remet pas la génération en COMPLETED, le remboursement reste.
    t.fal = 'COMPLETED'
    assert.equal((await t.as('user_alice', `/jobs/${id}`)).body.status, 'CANCELED')
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240)
    // La place est libre.
    t.fal = 'IN_QUEUE'
    assert.equal((await t.as('user_alice', '/jobs', post(image))).status, 202)
  } finally { t.restore() }
})

test('annulation par l\'administration : terminée chez fal pendant le suivi → COMPLETED avec ses fichiers, rien n\'est remboursé', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    t.fal = 'COMPLETED'
    const r = await t.admin(`/admin/users/user_alice/jobs/${job.body.jobId}/cancel`, post({ key: key(), reason: 'Bloquée ?' }))
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.outcome, r.body.refunded, r.body.job.status, r.body.job.outputs[0].url], ['completed', 0, 'COMPLETED', 'https://fal.media/chat.png'])
    assert.equal(r.body.balance, 240 - job.body.cost)
    assert.equal(t.cancels.length, 0)
  } finally { t.restore() }
})

test('Durable Object : /job/put ne change plus un statut définitif ; le même statut se remet ; /job/cancel et /job/refund', async () => {
  const m = new Map()
  const a = new Account({ storage: { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)) } } }, { ENV: 'dev' })
  const call = async (path, body) => { const res = await a.fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) })); return { status: res.status, body: await res.json() } }
  await call('/debit', { jobId: 'j1', amount: 10 })
  assert.equal((await call('/job/put', { id: 'j1', status: 'IN_QUEUE', cost: 10 })).status, 200)
  assert.equal((await call('/job/put', { id: 'j1', status: 'IN_PROGRESS', cost: 10, storingAt: 1 })).status, 200)
  assert.equal((await call('/job/put', { id: 'j1', status: 'COMPLETED', cost: 10, outputs: [{ url: 'a' }] })).status, 200)
  assert.equal((await call('/job/put', { id: 'j1', status: 'COMPLETED', cost: 10, outputs: [{ url: 'b' }] })).status, 200) // même statut : permis
  for (const status of ['FAILED', 'CANCELED', 'IN_PROGRESS']) {
    const r = await call('/job/put', { id: 'j1', status, cost: 10 })
    assert.deepEqual([r.status, r.body.error, r.body.status], [409, 'terminal', 'COMPLETED'])
  }
  assert.equal(m.get('job:j1').outputs[0].url, 'b')
  assert.equal((await call('/job/cancel', { jobId: 'j1', reason: 'x', actor: 'adm' })).body.error, 'not_active')
  assert.equal((await call('/job/cancel', { jobId: 'nope', reason: 'x', actor: 'adm' })).status, 404)
  assert.equal((await call('/job/refund', { jobId: 'nope', reason: 'x', actor: 'adm' })).status, 404)
  // Remboursée par le suivi avant l'annulation : rien de plus n'est rendu.
  await call('/debit', { jobId: 'j2', amount: 10 })
  await call('/job/put', { id: 'j2', status: 'IN_PROGRESS', cost: 10 })
  await call('/refund', { jobId: 'j2', amount: 4 })
  const c = await call('/job/cancel', { jobId: 'j2', reason: 'x', actor: 'adm' })
  assert.deepEqual([c.body.refunded, c.body.job.refund, c.body.job.status], [0, 4, 'CANCELED'])
  assert.deepEqual(m.get('active'), {})
  // Sans débit (réservée, jamais facturée) : pas de remboursement possible.
  await call('/job/put', { id: 'j3', status: 'FAILED', cost: 10 })
  assert.equal((await call('/job/refund', { jobId: 'j3', reason: 'x', actor: 'adm' })).body.error, 'no_debit')
})

test('Durable Object : un même statut remis ne perd pas les notes de l\'administration ; /job/fail et /job/cancel ne touchent pas une génération terminée ou en cours d\'enregistrement', async () => {
  const m = new Map()
  const a = new Account({ storage: { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)) } } }, { ENV: 'dev' })
  const call = async (path, body) => { const res = await a.fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) })); return { status: res.status, body: await res.json() } }
  const balance = async () => (await call('/balance', {})).body.balance
  // Annulée par l'administration, puis une annulation de l'utilisateur faite d'une copie plus ancienne : refund, failure et note restent.
  await call('/debit', { jobId: 'j1', amount: 10 })
  await call('/job/put', { id: 'j1', status: 'IN_QUEUE', cost: 10 })
  const stale = m.get('job:j1')
  assert.equal((await call('/job/cancel', { jobId: 'j1', reason: 'x', actor: 'adm' })).body.refunded, 10)
  assert.equal((await call('/job/put', { ...stale, status: 'CANCELED', refund: 0 })).status, 200)
  assert.deepEqual([m.get('job:j1').refund, m.get('job:j1').failure, m.get('job:j1').adminCancel.actor], [10, 'admin_cancel', 'adm'])
  // Remboursée par l'administration, puis une sortie remise (COMPLETED) d'une copie plus ancienne : le remboursement noté reste.
  await call('/debit', { jobId: 'j2', amount: 10 })
  await call('/job/put', { id: 'j2', status: 'COMPLETED', cost: 10, outputs: [{ url: 'a' }] })
  await call('/job/refund', { jobId: 'j2', amount: 4, reason: 'raté', actor: 'adm' })
  await call('/job/put', { id: 'j2', status: 'COMPLETED', cost: 10, outputs: [{ url: 'b' }] })
  assert.deepEqual([m.get('job:j2').refund, m.get('job:j2').adminRefund.reason, m.get('job:j2').outputs[0].url], [4, 'raté', 'b'])
  // Échec constaté après une annulation (IN_PROGRESS, non remboursée) : ni remboursement ni réécriture ; la génération enregistrée est rendue.
  await call('/debit', { jobId: 'j3', amount: 10 })
  await call('/job/put', { id: 'j3', status: 'IN_PROGRESS', cost: 10 })
  const before = await balance()
  const c = await call('/job/cancel', { jobId: 'j3', user: true })
  assert.deepEqual([c.body.refunded, c.body.job.status, c.body.job.failure, c.body.job.adminCancel], [0, 'CANCELED', undefined, undefined])
  const f = await call('/job/fail', { jobId: 'j3', failure: 'provider' })
  assert.deepEqual([f.status, f.body.error, f.body.job.status, f.body.job.refund], [409, 'terminal', 'CANCELED', 0])
  assert.equal(await balance(), before)
  // Échec d'une génération active : remboursée et FAILED d'un coup, place libérée.
  await call('/debit', { jobId: 'j4', amount: 10 })
  await call('/job/put', { id: 'j4', status: 'IN_PROGRESS', cost: 10 })
  const ok = await call('/job/fail', { jobId: 'j4', failure: 'moderation' })
  assert.deepEqual([ok.body.refunded, ok.body.job.status, ok.body.job.failure, ok.body.job.refund, await balance()], [10, 'FAILED', 'moderation', 10, before])
  assert.equal(m.get('active').j4, undefined)
  // Annulation de l'utilisateur après une fin ailleurs : refusée, sans remboursement, la génération terminée est rendue.
  await call('/debit', { jobId: 'j5', amount: 10 })
  await call('/job/put', { id: 'j5', status: 'COMPLETED', cost: 10, outputs: [{ url: 'a' }] })
  const late = await call('/job/cancel', { jobId: 'j5', user: true })
  assert.deepEqual([late.status, late.body.error, late.body.job.status], [409, 'not_active', 'COMPLETED'])
  // Copie des fichiers en cours (storingAt récent) : annulation refusée ; ancienne (copie abandonnée) : permise.
  await call('/debit', { jobId: 'j6', amount: 10 })
  await call('/job/put', { id: 'j6', status: 'IN_PROGRESS', cost: 10, storingAt: Date.now() })
  const busy = await call('/job/cancel', { jobId: 'j6', reason: 'x', actor: 'adm' })
  assert.deepEqual([busy.status, busy.body.error], [409, 'storing'])
  await call('/job/put', { id: 'j6', status: 'IN_PROGRESS', cost: 10, storingAt: Date.now() - 120_000 })
  assert.equal((await call('/job/cancel', { jobId: 'j6', reason: 'x', actor: 'adm' })).body.job.status, 'CANCELED')
  assert.equal(await balance(), before - 10) // j5 débitée (terminée), j6 débitée puis rendue
})

test('annulation de l\'utilisateur pendant que fal termine la génération : elle reste COMPLETED et n\'est pas remboursée', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const id = job.body.jobId
    // Pendant l'annulation chez fal, le suivi (ou le webhook) voit la génération terminée et l'enregistre.
    t.onCancel = async () => { t.onCancel = null; t.fal = 'COMPLETED'; await t.as('user_alice', `/jobs/${id}`) }
    const r = await t.as('user_alice', `/jobs/${id}/cancel`, { method: 'POST' })
    assert.deepEqual([r.body.status, r.body.refund, r.body.outputs[0].url, r.body.balance], ['COMPLETED', 0, 'https://fal.media/chat.png', 240 - job.body.cost])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240 - job.body.cost)
    assert.equal(t.rows('SELECT status FROM jobs WHERE id = ?', id)[0].status, 'COMPLETED')
  } finally { t.restore() }
})

test('échec chez fal vu par un suivi en retard, après une annulation sans remboursement : rien n\'est rendu, la génération reste CANCELED', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const id = job.body.jobId
    t.fal = 'IN_PROGRESS'
    await t.as('user_alice', `/jobs/${id}`)
    const snapshot = t.stores.get('user_alice').get(`job:${id}`) // copie IN_PROGRESS d'un suivi qui attend fal
    assert.deepEqual([(await t.as('user_alice', `/jobs/${id}/cancel`, { method: 'POST' })).body.refund], [0])
    t.fal = 'FAILED'
    const acct = async (path, body) => (await t.account('user_alice').fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) }))).json()
    const out = await advanceJob({ env: { FAL_KEY: 'test' }, acct, accountId: 'user_alice', origin: ORIGIN, job: snapshot })
    assert.deepEqual([out.job.status, out.job.refund], ['CANCELED', 0])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240 - job.body.cost)
    assert.equal(t.rows('SELECT status, refund FROM jobs WHERE id = ?', id)[0].refund, 0)
  } finally { t.restore() }
})

test('annulation par l\'administration pendant l\'enregistrement des fichiers : refusée (storing), rien n\'est remboursé', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const id = job.body.jobId
    const stored = t.stores.get('user_alice').get(`job:${id}`)
    await t.account('user_alice').fetch(new Request('https://account/job/put', { method: 'POST', body: JSON.stringify({ ...stored, status: 'IN_PROGRESS', storingAt: Date.now() }) }))
    t.fal = 'COMPLETED' // terminée chez fal, un autre suivi copie ses fichiers
    const r = await t.admin(`/admin/users/user_alice/jobs/${id}/cancel`, post({ key: key(), reason: 'Bloquée ?' }))
    assert.deepEqual([r.status, r.body.error], [409, 'storing'])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240 - job.body.cost)
    assert.equal(t.cancels.length, 0)
  } finally { t.restore() }
})

test('blocage : plus de génération, de recharge, d\'import ni d\'« Améliorer » ; le suivi, les webhooks et les remboursements continuent ; déblocage', async () => {
  const t = setup()
  try {
    const top = await t.as('user_alice', '/topups', post(topupReq))
    assert.equal(top.status, 201)
    const job = await t.as('user_alice', '/jobs', post(image))
    const k = key()
    const b = await t.admin('/admin/users/user_alice/block', post({ key: k, blocked: true, reason: 'Fraude suspectée' }))
    assert.equal(b.status, 200)
    assert.deepEqual([b.body.blocked.actor, b.body.blocked.reason], ['user_admin', 'Fraude suspectée'])
    assert.equal((await t.admin('/admin/users/user_alice/block', post({ key: k, blocked: true, reason: 'Fraude suspectée' }))).body.replayed, true)

    const refused = [
      ['/jobs', post(image)],
      ['/jobs', post({ ...image, requestId: 'meme-demande-123' })],
      ['/topups', post(topupReq)],
      ['/topups', post({ ...topupReq, reference: top.body.topup.reference })], // nouvel essai d'une recharge existante
      ['/topups/options?operator=moov&phone=70123456'],
      ['/enhance', post({ text: 'un chat qui danse sous la pluie', kind: 'image' })],
      ['/uploads?name=a.png', { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'x' }],
      ['/assets', { method: 'POST', headers: { 'content-type': 'image/png', 'content-length': '1' }, body: 'x' }],
    ]
    for (const [path, init] of refused) {
      const r = await t.as('user_alice', path, init)
      assert.deepEqual([r.status, r.body.error], [403, 'account_blocked'], path)
    }
    const me = await t.as('user_alice', '/me')
    assert.equal(me.body.blocked, true)
    assert.equal((await t.as('user_bob', '/me')).body.blocked, false)
    // Ce qui continue : suivi d'une génération, solde, webhook de paiement (crédit d'une recharge déjà ouverte).
    assert.equal((await t.as('user_alice', `/jobs/${job.body.jobId}`)).status, 200)
    assert.equal((await t.as('user_alice', '/wallet')).status, 200)
    const raw = JSON.stringify({ id: 'evt1', type: 'payment.completed', data: { id: 'pg1', reference: top.body.topup.reference, status: 'completed', amount: 5000, currency: 'XOF', metadata: { account: 'user_alice' } } })
    await app.fetch(new Request('http://api/webhooks/payments', { method: 'POST', headers: { 'paygate-signature': await signBody('whsec', raw, Math.floor(Date.now() / 1000)) }, body: raw }), { PAYGATE_WEBHOOK_SECRET: 'whsec', ACCOUNT: { idFromName: (x) => x, get: (x) => ({ fetch: (u, i) => t.account(x).fetch(new Request(u, i)) }) } })
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240 - job.body.cost + 160)
    // Une annulation de l'utilisateur reste possible (et remboursée).
    assert.equal((await t.as('user_alice', `/jobs/${job.body.jobId}/cancel`, { method: 'POST' })).body.status, 'CANCELED')

    // Copie dans D1 pour les listes ; fiche : bloqué.
    assert.equal((await t.admin('/admin/users?q=user_alice')).body.users[0].blockedAt, b.body.blocked.at)
    const page = await t.admin('/admin/users/user_alice')
    assert.deepEqual([page.body.blocked.reason, page.body.user.blockedReason], ['Fraude suspectée', 'Fraude suspectée'])

    const u = await t.admin('/admin/users/user_alice/block', post({ key: key(), blocked: false, reason: 'Vérifié, compte sain' }))
    assert.deepEqual([u.status, u.body.blocked], [200, null])
    assert.equal((await t.as('user_alice', '/jobs', post(image))).status, 202)
    assert.equal((await t.as('user_alice', '/me')).body.blocked, false)
    assert.equal((await t.admin('/admin/users?q=user_alice')).body.users[0].blockedAt, null)
    assert.deepEqual(t.rows('SELECT action FROM admin_actions ORDER BY at').map((r) => r.action), ['block', 'unblock'])
    assert.equal((await t.admin('/admin/users/user_alice/block', post({ key: key(), blocked: 'oui', reason: 'Fraude suspectée' }))).status, 400)
  } finally { t.restore() }
})

test('administration : photo, nom et e-mail du jeton dans la recherche, la fiche, les recharges et les générations ; adresse invalide ignorée', async () => {
  const t = setup()
  try {
    t.claims.user_alice = { name: 'Alice Ouédraogo', picture: 'https://img.clerk.com/alice' }
    t.claims.user_bob = { name: 'Bob', picture: 'http://img.clerk.com/bob' } // pas https : ignorée
    await t.as('user_alice', '/wallet')
    await t.as('user_bob', '/wallet')
    const list = await t.admin('/admin/users')
    const byId = Object.fromEntries(list.body.users.map((u) => [u.id, u]))
    assert.deepEqual([byId.user_alice.name, byId.user_alice.email, byId.user_alice.avatarUrl], ['Alice Ouédraogo', 'alice@example.test', 'https://img.clerk.com/alice'])
    assert.deepEqual([byId.user_bob.name, byId.user_bob.avatarUrl], ['Bob', null])
    assert.equal(byId.user_admin.avatarUrl, null)
    assert.deepEqual((await t.admin('/admin/users?q=alice@')).body.users.map((u) => u.avatarUrl), ['https://img.clerk.com/alice'])
    const page = await t.admin('/admin/users/user_alice')
    assert.deepEqual([page.body.user.name, page.body.user.email, page.body.user.avatarUrl], ['Alice Ouédraogo', 'alice@example.test', 'https://img.clerk.com/alice'])
    assert.equal((await t.admin('/admin/users/user_bob')).body.user.avatarUrl, null)
    await t.as('user_alice', '/topups', post(topupReq))
    const job = await t.as('user_bob', '/jobs', post(image))
    assert.deepEqual((await t.admin('/admin/topups')).body.topups.map((x) => [x.account, x.name, x.avatarUrl]), [['user_alice', 'Alice Ouédraogo', 'https://img.clerk.com/alice']])
    assert.deepEqual((await t.admin('/admin/jobs')).body.jobs.map((j) => [j.id, j.name, j.email, j.avatarUrl]), [[job.body.jobId, 'Bob', 'bob@example.test', null]])
  } finally { t.restore() }
})

test('recharges : liste de tous les comptes (statut, bloquées) ; revérification chez paygate → crédit sur le compte visé, une seule fois', async () => {
  const t = setup()
  try {
    const top = await t.as('user_alice', '/topups', post(topupReq))
    const ref = top.body.topup.reference
    const all = await t.admin('/admin/topups')
    assert.deepEqual(all.body.topups.map((x) => [x.reference, x.account, x.email, x.status, x.stuck]), [[ref, 'user_alice', 'alice@example.test', 'processing', false]])
    assert.deepEqual((await t.admin('/admin/topups?stuck=1')).body.topups, [])
    t.db.raw.prepare('UPDATE topups SET created_at = created_at - 3600000').run() // ouverte depuis une heure
    const stuck = await t.admin('/admin/topups?stuck=1')
    assert.deepEqual(stuck.body.topups.map((x) => [x.reference, x.stuck, x.ageMin >= 59]), [[ref, true, true]])
    assert.deepEqual((await t.admin('/admin/topups?status=completed')).body.topups, [])
    assert.equal((await t.admin('/admin/topups?status=%27x')).status, 400)

    // Paygate dit encore « en cours » : rien n'est crédité.
    t.pg[ref] = { id: 'pg1', reference: ref, status: 'processing', amount: 5000, currency: 'XOF' }
    const wait = await t.admin(`/admin/users/user_alice/topups/${ref}/recheck`, post({ key: key() }))
    assert.deepEqual([wait.status, wait.body.credited, wait.body.topup.status], [200, 0, 'processing'])
    // Payée : crédit par le chemin habituel.
    t.pg[ref] = { ...t.pg[ref], status: 'completed' }
    const k = key()
    const paid = await t.admin(`/admin/users/user_alice/topups/${ref}/recheck`, post({ key: k }))
    assert.deepEqual([paid.status, paid.body.credited, paid.body.topup.status, paid.body.balance], [200, 160, 'completed', 400])
    assert.equal((await t.admin(`/admin/users/user_alice/topups/${ref}/recheck`, post({ key: k }))).body.replayed, true)
    const done = await t.admin(`/admin/users/user_alice/topups/${ref}/recheck`, post({ key: key() }))
    assert.deepEqual([done.status, done.body.error], [409, 'already_completed'])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 400) // une seule fois
    assert.equal((await t.admin('/wallet')).body.balance, 240)
    assert.equal(t.rows("SELECT status FROM topups")[0].status, 'completed')
    assert.equal(t.rows("SELECT * FROM admin_actions WHERE action = 'recheck_topup' AND result IS NOT NULL").length, 2)
    // Un montant différent n'est jamais crédité.
    const other = await t.as('user_bob', '/topups', post(topupReq))
    t.pg[other.body.topup.reference] = { id: 'pg2', reference: other.body.topup.reference, status: 'completed', amount: 9999, currency: 'XOF' }
    const bad = await t.admin(`/admin/users/user_bob/topups/${other.body.topup.reference}/recheck`, post({ key: key() }))
    assert.deepEqual([bad.body.credited, bad.body.mismatch, bad.body.topup.mismatch.amount], [0, true, 9999])
    // Mauvais compte, recharge inconnue, paygate absent.
    assert.equal((await t.admin(`/admin/users/user_bob/topups/${ref}/recheck`, post({ key: key() }))).status, 404)
  } finally { t.restore() }
  const e = setup({ PAYGATE_URL: '' })
  try {
    await e.as('user_alice', '/wallet')
    assert.equal((await e.admin('/admin/users/user_alice/topups/yl_X/recheck', post({ key: key() }))).status, 503)
  } finally { e.restore() }
})

test('revérification : une recharge échouée payée en retard est créditée ; paygate en panne → 502, rien n\'est noté', async () => {
  const t = setup()
  try {
    const top = await t.as('user_alice', '/topups', post(topupReq))
    const ref = top.body.topup.reference
    t.pg[ref] = { id: 'pg1', reference: ref, status: 'failed', amount: 5000, currency: 'XOF', failure: 'declined' }
    assert.equal((await t.admin(`/admin/users/user_alice/topups/${ref}/recheck`, post({ key: key() }))).body.topup.status, 'failed')
    assert.ok(t.stores.get('user_alice').get(`topup:${ref}`).checkedAt) // `from` comprend « failed »
    delete t.pg[ref] // paygate ne la connaît plus : erreur, rien n'est noté
    const k = key()
    const down = await t.admin(`/admin/users/user_alice/topups/${ref}/recheck`, post({ key: k }))
    assert.deepEqual([down.status, down.body.error], [502, 'not_found'])
    t.pg[ref] = { id: 'pg1', reference: ref, status: 'completed', amount: 5000, currency: 'XOF' }
    const late = await t.admin(`/admin/users/user_alice/topups/${ref}/recheck`, post({ key: k })) // même clé : réessai sans risque
    assert.deepEqual([late.status, late.body.credited, late.body.topup.late], [200, 160, true])
  } finally { t.restore() }
})

test('générations en cours : tous les comptes, âge et « bloquée » au-delà de 30 min ; vide sans génération', async () => {
  const t = setup()
  try {
    await t.as('user_alice', '/wallet')
    assert.deepEqual((await t.admin('/admin/jobs')).body.jobs, [])
    const a = await t.as('user_alice', '/jobs', post(image))
    const b = await t.as('user_bob', '/jobs', post(image))
    t.db.raw.prepare('UPDATE jobs SET created_at = created_at - 3600000 WHERE id = ?').run(a.body.jobId)
    const active = await t.admin('/admin/jobs?scope=active')
    assert.deepEqual(active.body.jobs.map((j) => [j.id, j.userId, j.email, j.stuck]), [[b.body.jobId, 'user_bob', 'bob@example.test', false], [a.body.jobId, 'user_alice', 'alice@example.test', true]])
    assert.deepEqual((await t.admin('/admin/jobs?scope=stuck')).body.jobs.map((j) => j.id), [a.body.jobId])
    await t.admin(`/admin/users/user_alice/jobs/${a.body.jobId}/cancel`, post({ key: key(), reason: 'Bloquée chez fal' }))
    assert.deepEqual((await t.admin('/admin/jobs?scope=stuck')).body.jobs, [])
  } finally { t.restore() }
})

test('administration : D1 en panne après l\'action → l\'argent reste, l\'erreur est journalisée', async () => {
  const t = setup()
  const errors = []
  const realError = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    await t.as('user_alice', '/wallet')
    // `target` lit D1 (réussite), puis le journal échoue : on simule une panne seulement sur l'écriture du journal.
    const prepare = t.db.prepare
    t.db.prepare = (sql) => (sql.includes('DO UPDATE SET amount') ? { bind: () => ({ run: async () => { throw new Error('D1 indisponible') } }) } : prepare(sql))
    const r = await t.admin('/admin/users/user_alice/adjust', post({ key: key(), direction: 'credit', amount: 10, reason: 'Geste commercial' }))
    assert.deepEqual([r.status, r.body.balance], [200, 250])
    assert.ok(errors.some((e) => e.includes('journal non écrit')))
    t.db.prepare = prepare
  } finally { console.error = realError; t.restore() }
})

test('échec vu par un second suivi pendant la copie des fichiers : refusé (storing), le premier suivi termine avec les fichiers, rien n\'est rendu', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const id = job.body.jobId
    const snapshot = t.stores.get('user_alice').get(`job:${id}`)
    t.fal = 'COMPLETED'
    let open
    const gate = new Promise((r) => { open = r })
    let resultDown = false
    const fake = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      const u = String(url)
      if (u === 'https://fal.media/chat.png') { await gate; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }) }
      if (resultDown && u === 'https://queue.fal.run/x/requests/r1') return Response.json({ detail: 'résultat refusé' }, { status: 422 }) // définitif : FAILED « provider »
      return fake(url, init)
    }
    const files = new Map()
    const env = { FAL_KEY: 'test', FILES: { put: async (k, body) => { files.set(k, await new Response(body).arrayBuffer()) } } }
    const acct = async (path, body) => (await t.account('user_alice').fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) }))).json()
    const storer = advanceJob({ env, acct, accountId: 'user_alice', origin: ORIGIN, job: snapshot })
    while (!t.stores.get('user_alice').get(`job:${id}`).storingAt) await new Promise((r) => setTimeout(r, 1))
    resultDown = true // le second suivi voit COMPLETED mais la lecture du résultat échoue : FAILED « provider »
    const second = await advanceJob({ env, acct, accountId: 'user_alice', origin: ORIGIN, job: snapshot })
    assert.equal(second.job.status, 'IN_PROGRESS')
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240 - job.body.cost)
    resultDown = false
    open()
    const first = await storer
    assert.deepEqual([first.job.status, first.job.outputs[0].stored, files.size], ['COMPLETED', true, 1])
    assert.equal(t.stores.get('user_alice').get(`job:${id}`).status, 'COMPLETED')
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240 - job.body.cost)
  } finally { t.restore() }
})

test('Durable Object : une copie plus ancienne (sans storingAt) ne retire pas la marque d\'enregistrement ; l\'annulation reste refusée et les fichiers arrivent', async () => {
  const m = new Map()
  const a = new Account({ storage: { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)) } } }, { ENV: 'dev' })
  const call = async (path, body) => { const res = await a.fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) })); return { status: res.status, body: await res.json() } }
  const balance = async () => (await call('/balance', {})).body.balance
  await call('/debit', { jobId: 'j1', amount: 10 })
  await call('/job/put', { id: 'j1', status: 'IN_QUEUE', cost: 10 })
  const start = await balance()
  const at = Date.now()
  await call('/job/put', { id: 'j1', status: 'IN_PROGRESS', cost: 10, storingAt: at }) // le webhook copie les fichiers
  await call('/job/put', { id: 'j1', status: 'IN_PROGRESS', cost: 10, startedAt: at }) // le suivi, d'une copie IN_QUEUE
  assert.equal(m.get('job:j1').storingAt, at)
  assert.equal(m.get('job:j1').startedAt, at)
  const c = await call('/job/cancel', { jobId: 'j1', user: true })
  assert.deepEqual([c.status, c.body.error], [409, 'storing'])
  const done = await call('/job/put', { id: 'j1', status: 'COMPLETED', cost: 10, outputs: [{ url: 'a' }] })
  assert.equal(done.status, 200)
  assert.deepEqual([m.get('job:j1').status, m.get('job:j1').outputs[0].url, m.get('job:j1').storingAt, await balance()], ['COMPLETED', 'a', undefined, start])
  // Marque ancienne (copie abandonnée) : elle n'est pas gardée.
  await call('/debit', { jobId: 'j2', amount: 10 })
  await call('/job/put', { id: 'j2', status: 'IN_PROGRESS', cost: 10, storingAt: Date.now() - 120_000 })
  await call('/job/put', { id: 'j2', status: 'IN_PROGRESS', cost: 10 })
  assert.equal(m.get('job:j2').storingAt, undefined)
  // /job/fail pendant une copie récente : refusé, ni remboursement ni réécriture.
  await call('/debit', { jobId: 'j3', amount: 10 })
  await call('/job/put', { id: 'j3', status: 'IN_PROGRESS', cost: 10, storingAt: Date.now() })
  const before = await balance()
  const f = await call('/job/fail', { jobId: 'j3', failure: 'provider' })
  assert.deepEqual([f.status, f.body.error, f.body.job.status, await balance()], [409, 'storing', 'IN_PROGRESS', before])
})

test('journal : le montant d\'un remboursement est ce qui a été rendu (plafonné, ou tout par défaut) ; celui d\'une annulation aussi ; la clé rejouée compare le montant demandé', async () => {
  const t = setup()
  try {
    const done = async () => { t.fal = 'IN_QUEUE'; const j = await t.as('user_alice', '/jobs', post(image)); t.fal = 'COMPLETED'; await t.as('user_alice', `/jobs/${j.body.jobId}`); return j.body }
    const amountOf = (k) => t.rows('SELECT amount FROM admin_actions WHERE id = ?', k)[0].amount
    const a = await done()
    const k1 = key()
    assert.equal((await t.admin(`/admin/users/user_alice/jobs/${a.jobId}/refund`, post({ key: k1, amount: 999, reason: 'Résultat raté' }))).body.refunded, a.cost)
    assert.equal(amountOf(k1), a.cost)
    const again = await t.admin(`/admin/users/user_alice/jobs/${a.jobId}/refund`, post({ key: k1, amount: 999, reason: 'Résultat raté' }))
    assert.deepEqual([again.status, again.body.replayed, again.body.refunded], [200, true, a.cost])
    assert.equal((await t.admin(`/admin/users/user_alice/jobs/${a.jobId}/refund`, post({ key: k1, amount: a.cost, reason: 'Résultat raté' }))).body.error, 'key_conflict')
    const b = await done()
    const k2 = key()
    await t.admin(`/admin/users/user_alice/jobs/${b.jobId}/refund`, post({ key: k2, reason: 'Résultat raté' })) // tout, par défaut
    assert.equal(amountOf(k2), b.cost)
    assert.equal((await t.admin(`/admin/users/user_alice/jobs/${b.jobId}/refund`, post({ key: k2, reason: 'Résultat raté' }))).body.replayed, true)
    t.fal = 'IN_QUEUE'
    const c = (await t.as('user_alice', '/jobs', post(image))).body
    const k3 = key()
    assert.equal((await t.admin(`/admin/users/user_alice/jobs/${c.jobId}/cancel`, post({ key: k3, reason: 'Bloquée chez fal' }))).body.refunded, c.cost)
    assert.equal(amountOf(k3), c.cost)
  } finally { t.restore() }
})

test('administration : journal D1 non écrit et réponse perdue → la même clé rend le premier résultat (remboursement, annulation, blocage), puis est notée', async () => {
  const t = setup()
  const realError = console.error
  console.error = () => {}
  try {
    t.fal = 'IN_QUEUE'
    const a = (await t.as('user_alice', '/jobs', post(image))).body
    t.fal = 'COMPLETED'
    await t.as('user_alice', `/jobs/${a.jobId}`)
    t.fal = 'IN_QUEUE'
    const c = (await t.as('user_alice', '/jobs', post(image))).body
    const prepare = t.db.prepare
    t.db.prepare = (sql) => (sql.includes('DO UPDATE SET amount') ? { bind: () => ({ run: async () => { throw new Error('D1 indisponible') } }) } : prepare(sql))
    const kr = key(), kc = key(), kb = key()
    const refund = () => t.admin(`/admin/users/user_alice/jobs/${a.jobId}/refund`, post({ key: kr, amount: 2, reason: 'Résultat raté' }))
    const cancel = () => t.admin(`/admin/users/user_alice/jobs/${c.jobId}/cancel`, post({ key: kc, reason: 'Bloquée chez fal' }))
    const block = () => t.admin('/admin/users/user_alice/block', post({ key: kb, blocked: true, reason: 'Fraude' }))
    const first = [await refund(), await cancel(), await block()]
    assert.deepEqual(first.map((r) => r.status), [200, 200, 200])
    assert.equal(t.rows('SELECT * FROM admin_actions WHERE result IS NOT NULL').length, 0) // réservées, sans résultat
    t.db.prepare = prepare
    const r = await refund()
    assert.deepEqual([r.status, r.body.replayed, r.body.refunded], [200, true, 2])
    const x = await cancel()
    assert.deepEqual([x.status, x.body.replayed, x.body.outcome, x.body.refunded], [200, true, 'canceled', c.cost])
    const bl = await block()
    assert.deepEqual([bl.status, bl.body.replayed, bl.body.blocked.at], [200, true, first[2].body.blocked.at])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240 - a.cost + 2) // rien n'est rendu deux fois
    assert.deepEqual(t.rows('SELECT action, amount FROM admin_actions ORDER BY at').map((l) => [l.action, l.amount]), [['refund_job', 2], ['cancel_job', c.cost], ['block', null]])
    // Même clé pour une autre action : conflit.
    assert.equal((await t.admin(`/admin/users/user_alice/jobs/${c.jobId}/cancel`, post({ key: kr, reason: 'Bloquée chez fal' }))).body.error, 'key_conflict')
    assert.equal((await t.admin('/admin/users/user_alice/block', post({ key: kc, blocked: false, reason: 'Fraude' }))).status, 409)
  } finally { console.error = realError; t.restore() }
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Requête dont le corps arrive en retard (`ms`) : pendant ce temps, d'autres requêtes passent dans le Durable Object. */
const slowRequest = (path, body, ms) => new Request(`https://account${path}`, {
  method: 'POST', duplex: 'half',
  body: new ReadableStream({ async start(ctrl) { await sleep(ms); ctrl.enqueue(new TextEncoder().encode(JSON.stringify(body))); ctrl.close() } }),
})
const memAccount = () => {
  const m = new Map()
  const a = new Account({ storage: { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)) } } }, { ENV: 'dev' })
  const call = async (path, body) => (await a.fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) }))).json()
  return { m, a, call }
}

test('Durable Object : un corps lu lentement ne réécrit pas un portefeuille périmé (ajustement, crédit, échec) pendant qu\'un débit passe', async () => {
  for (const [path, body, expected] of [
    ['/admin/adjust', { key: 'adm_lent_12345678', direction: 'credit', amount: 100, reason: 'Geste', actor: 'user_admin' }, 300],
    ['/credit', { paymentId: 'p-lent', amount: 100 }, 300],
  ]) {
    const { m, a, call } = memAccount()
    assert.equal((await call('/balance', {})).balance, 240)
    const slow = a.fetch(slowRequest(path, body, 30)) // le portefeuille (240) serait lu avant le corps
    const d = await call('/debit', { jobId: 'j1', amount: 40 })
    assert.equal(d.ok, true)
    await slow
    assert.equal(m.get('wallet').balance, expected, path) // 240 - 40 + 100, pas 340
    assert.ok(m.get('wallet').ops['debit:j1'], path) // le débit n'est pas perdu
  }
  // Échec constaté (remboursement de j0) pendant un débit de j1.
  const { m, a, call } = memAccount()
  await call('/debit', { jobId: 'j0', amount: 50 })
  await call('/job/put', { id: 'j0', status: 'IN_PROGRESS', cost: 50 })
  const slow = a.fetch(slowRequest('/job/fail', { jobId: 'j0', failure: 'provider' }, 30))
  await call('/debit', { jobId: 'j1', amount: 40 })
  await slow
  assert.deepEqual([m.get('wallet').balance, Boolean(m.get('wallet').ops['debit:j1'])], [200, true]) // 240 - 50 - 40 + 50
})

test('clé d\'administration réservée avant l\'action : la même clé envoyée en même temps pour deux comptes ne crédite qu\'un seul compte', async () => {
  const t = setup()
  try {
    await t.as('user_alice', '/wallet')
    await t.as('user_bob', '/wallet')
    // Les deux requêtes passent la lecture du journal avant que l'une n'atteigne son Durable Object (au plus 100 ms d'attente).
    let arrived = 0, release
    const both = new Promise((r) => { release = r })
    for (const name of ['user_alice', 'user_bob']) {
      const acct = t.account(name)
      const real = acct.fetch.bind(acct)
      acct.fetch = async (req) => {
        if (new URL(req.url).pathname === '/admin/adjust') { if (++arrived === 2) release(); await Promise.race([both, sleep(100)]) }
        return real(req)
      }
    }
    const k = key()
    const [a, b] = await Promise.all(['user_alice', 'user_bob'].map((u) => t.admin(`/admin/users/${u}/adjust`, post({ key: k, direction: 'credit', amount: 100, reason: 'Geste commercial' }))))
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
    assert.equal([a, b].find((r) => r.status === 409).body.error, 'key_conflict')
    const balances = [(await t.as('user_alice', '/wallet')).body.balance, (await t.as('user_bob', '/wallet')).body.balance]
    assert.deepEqual(balances.sort(), [240, 340]) // un seul crédit
    const rows = t.rows('SELECT target FROM admin_actions WHERE id = ? AND result IS NOT NULL', k)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].target, [a, b][0].status === 200 ? 'user_alice' : 'user_bob') // la ligne est celle du compte crédité
    // Fiche : une clé réservée sans résultat (refusée) n'apparaît pas comme une action faite.
    const r = await t.admin('/admin/users/user_alice/adjust', post({ key: key(), direction: 'debit', amount: 9999, reason: 'Erreur de crédit' }))
    assert.equal(r.status, 402)
    assert.ok((await t.admin('/admin/users/user_alice')).body.actions.every((x) => x.result))
  } finally { t.restore() }
})

test('revérification créditée mais journal D1 non écrit : la même clé rend le premier résultat et le note (au lieu de 409 already_completed)', async () => {
  const t = setup()
  const realError = console.error
  console.error = () => {}
  try {
    const top = await t.as('user_alice', '/topups', post(topupReq))
    const ref = top.body.topup.reference
    t.pg[ref] = { id: 'pg1', reference: ref, status: 'completed', amount: 5000, currency: 'XOF' }
    const prepare = t.db.prepare
    t.db.prepare = (sql) => (sql.includes('DO UPDATE SET amount') ? { bind: () => ({ run: async () => { throw new Error('D1 indisponible') } }) } : prepare(sql))
    const k = key()
    const first = await t.admin(`/admin/users/user_alice/topups/${ref}/recheck`, post({ key: k }))
    assert.deepEqual([first.status, first.body.credited, first.body.topup.status], [200, 160, 'completed'])
    assert.equal(t.rows("SELECT * FROM admin_actions WHERE action = 'recheck_topup' AND result IS NOT NULL").length, 0)
    t.db.prepare = prepare
    const again = await t.admin(`/admin/users/user_alice/topups/${ref}/recheck`, post({ key: k }))
    assert.deepEqual([again.status, again.body.replayed, again.body.credited], [200, true, 160])
    const row = t.rows("SELECT amount, result FROM admin_actions WHERE id = ? AND result IS NOT NULL", k)
    assert.deepEqual([row.length, row[0].amount], [1, 160])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 400) // une seule fois
    // La même clé pour une autre recharge : conflit.
    const other = await t.as('user_alice', '/topups', post(topupReq))
    assert.equal((await t.admin(`/admin/users/user_alice/topups/${other.body.topup.reference}/recheck`, post({ key: k }))).body.error, 'key_conflict')
  } finally { console.error = realError; t.restore() }
})

test('terminée chez fal mais résultat en 503 : ni échec ni remboursement ; l\'annulation de l\'administration rend 503 sans annuler, les fichiers arrivent ensuite', async () => {
  const t = setup()
  const realError = console.error
  console.error = () => {}
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const id = job.body.jobId
    const charged = 240 - job.body.cost
    t.fal = 'COMPLETED'
    let down = true
    const fake = globalThis.fetch
    globalThis.fetch = async (url, init) => (down && String(url) === 'https://queue.fal.run/x/requests/r1' ? Response.json({ detail: 'indisponible' }, { status: 503 }) : fake(url, init))
    const poll = await t.as('user_alice', `/jobs/${id}`)
    assert.deepEqual([poll.status, poll.body.error], [502, 'upstream']) // passagère : l'interface réessaiera
    const k = key()
    const cancel = await t.admin(`/admin/users/user_alice/jobs/${id}/cancel`, post({ key: k, reason: 'Bloquée chez fal' }))
    assert.deepEqual([cancel.status, cancel.body.error, cancel.body.retryable], [503, 'provider_unavailable', true])
    assert.deepEqual([t.stores.get('user_alice').get(`job:${id}`).status, t.cancels.length], ['IN_QUEUE', 0]) // ni FAILED ni CANCELED
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, charged) // rien n'est remboursé
    down = false
    const done = await t.as('user_alice', `/jobs/${id}`)
    assert.deepEqual([done.body.status, done.body.outputs.length, done.body.refund], ['COMPLETED', 1, 0])
    // La même clé, réessayée : la génération est terminée, rien n'est annulé.
    assert.deepEqual([(await t.admin(`/admin/users/user_alice/jobs/${id}/cancel`, post({ key: k, reason: 'Bloquée chez fal' }))).status], [409])
  } finally { console.error = realError; t.restore() }
})

test('liste des comptes suspendus (D1) : un blocage dont l\'écriture arrive après un déblocage est corrigé ; une écriture perdue se répare à la lecture de la fiche', async () => {
  const t = setup()
  const realError = console.error
  console.error = () => {}
  try {
    await t.as('user_alice', '/wallet')
    const prepare = t.db.prepare
    let hold = true, held, reached
    const gate = new Promise((r) => { held = r })
    const atInsert = new Promise((r) => { reached = r })
    t.db.prepare = (sql) => {
      if (!sql.startsWith('INSERT INTO user_blocks') || !hold) return prepare(sql)
      hold = false
      const stmt = prepare(sql)
      return { bind: (...args) => ({ run: async () => { reached(); await gate; return stmt.bind(...args).run() } }) }
    }
    const blocking = t.admin('/admin/users/user_alice/block', post({ key: key(), blocked: true, reason: 'Fraude' }))
    await atInsert // le blocage est fait dans le Durable Object, sa copie dans D1 est retenue
    const unblock = await t.admin('/admin/users/user_alice/block', post({ key: key(), blocked: false, reason: 'Erreur' }))
    assert.equal(unblock.status, 200)
    held()
    assert.equal((await blocking).status, 200)
    assert.equal((await t.as('user_alice', '/me')).body.blocked, false)
    assert.deepEqual(t.rows('SELECT * FROM user_blocks'), []) // pas « suspendu » dans la liste
    assert.equal((await t.admin('/admin/users?q=user_alice')).body.users[0].blockedAt, null)

    // Écriture dans D1 perdue : le Durable Object bloque, la liste ne le sait pas ; la fiche la répare.
    t.db.prepare = (sql) => (sql.startsWith('INSERT INTO user_blocks') ? { bind: () => ({ run: async () => { throw new Error('D1 indisponible') } }) } : prepare(sql))
    assert.equal((await t.admin('/admin/users/user_alice/block', post({ key: key(), blocked: true, reason: 'Fraude' }))).status, 200)
    assert.deepEqual(t.rows('SELECT * FROM user_blocks'), [])
    t.db.prepare = prepare
    const page = await t.admin('/admin/users/user_alice')
    assert.ok(page.body.user.blockedAt)
    assert.equal(t.rows('SELECT reason FROM user_blocks WHERE user_id = ?', 'user_alice')[0].reason, 'Fraude')
    assert.ok((await t.admin('/admin/users?q=user_alice')).body.users[0].blockedAt)
  } finally { console.error = realError; t.restore() }
})

test('recharges : `limit` non entier (1.5) est arrondi, pas une erreur SQLite', async () => {
  const t = setup()
  try {
    await t.as('user_alice', '/topups', post(topupReq))
    for (const limit of ['1.5', '199.5', '-3.7', 'abc']) {
      const r = await t.admin(`/admin/topups?limit=${limit}`)
      assert.equal(r.status, 200, limit)
      assert.equal(r.body.topups.length, 1, limit)
    }
  } finally { t.restore() }
})

test('annulation de l\'utilisateur pendant l\'enregistrement des fichiers : pas d\'annulation chez fal, la génération reste en cours', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const m = t.stores.get('user_alice')
    m.set(`job:${job.body.jobId}`, { ...m.get(`job:${job.body.jobId}`), status: 'IN_PROGRESS', storingAt: Date.now() })
    const r = await t.as('user_alice', `/jobs/${job.body.jobId}/cancel`, { method: 'POST' })
    assert.deepEqual([r.status, r.body.status, r.body.refund, t.cancels.length], [200, 'IN_PROGRESS', 0, 0])
    assert.equal(m.get(`job:${job.body.jobId}`).status, 'IN_PROGRESS')
  } finally { t.restore() }
})

test('deux suivis partis de la même copie voient fal terminé : un seul copie les fichiers dans R2', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const id = job.body.jobId
    const snapshot = t.stores.get('user_alice').get(`job:${id}`)
    t.fal = 'COMPLETED'
    let open
    const gate = new Promise((r) => { open = r })
    let downloads = 0
    const fake = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      if (String(url) === 'https://fal.media/chat.png') { downloads++; await gate; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }) }
      return fake(url, init)
    }
    let puts = 0
    const env = { FAL_KEY: 'test', FILES: { put: async () => { puts++ } } }
    const acct = async (path, body) => (await t.account('user_alice').fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) }))).json()
    const first = advanceJob({ env, acct, accountId: 'user_alice', origin: ORIGIN, job: snapshot })
    while (!t.stores.get('user_alice').get(`job:${id}`).storingAt) await sleep(1)
    const second = advanceJob({ env, acct, accountId: 'user_alice', origin: ORIGIN, job: snapshot }) // même copie, sans storingAt
    await sleep(20)
    open()
    const [a, b] = await Promise.all([first, second])
    assert.deepEqual([puts, downloads], [1, 1])
    assert.equal(a.job.status, 'COMPLETED')
    assert.equal(b.job.status, 'IN_PROGRESS') // refusé : l'autre suivi enregistre
    assert.equal(t.stores.get('user_alice').get(`job:${id}`).status, 'COMPLETED')
  } finally { t.restore() }
})

test('annulation de l\'utilisateur : l\'état est relu chez fal ; déjà commencée là-bas (encore IN_QUEUE ici), elle n\'est pas remboursée', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const id = job.body.jobId
    assert.equal(t.stores.get('user_alice').get(`job:${id}`).status, 'IN_QUEUE') // l'état enregistré date de l'envoi
    t.fal = 'IN_PROGRESS'
    const r = await t.as('user_alice', `/jobs/${id}/cancel`, { method: 'POST' })
    assert.deepEqual([r.status, r.body.status, r.body.refund, r.body.balance], [200, 'CANCELED', 0, 240 - job.body.cost])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240 - job.body.cost)
    assert.equal(t.cancels.length, 1) // annulée chez fal quand même
    assert.equal(t.rows("SELECT COUNT(*) AS n FROM ledger WHERE kind = 'refund'")[0].n, 0)
  } finally { t.restore() }
})

test('annulation de l\'utilisateur : encore en file chez fal et annulation confirmée, remboursement complet', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    const r = await t.as('user_alice', `/jobs/${job.body.jobId}/cancel`, { method: 'POST' })
    assert.deepEqual([r.body.status, r.body.refund, r.body.balance, t.cancels.length], ['CANCELED', job.body.cost, 240, 1])
  } finally { t.restore() }
})

test('annulation de l\'utilisateur : fal ne confirme pas l\'annulation (erreur), pas de remboursement ; en file, elle reste active et se réannule', async () => {
  const t = setup()
  try {
    const refused = () => { throw new Error('fal injoignable') }
    const stored = (id) => t.stores.get('user_alice').get(`job:${id}`).status
    // En file chez fal, mais l'annulation échoue : la génération peut encore s'y lancer. Ni remboursée ni perdue : elle reste suivie.
    const a = await t.as('user_alice', '/jobs', post(image))
    t.onCancel = refused
    const ra = await t.as('user_alice', `/jobs/${a.body.jobId}/cancel`, { method: 'POST' })
    assert.deepEqual([ra.body.status, ra.body.refund ?? 0, ra.body.balance, stored(a.body.jobId)], ['IN_QUEUE', 0, 240 - a.body.cost, 'IN_QUEUE'])
    // État illisible et annulation en échec : pareil.
    const b = await t.as('user_alice', '/jobs', post(image))
    t.fal = 'DOWN'
    const rb = await t.as('user_alice', `/jobs/${b.body.jobId}/cancel`, { method: 'POST' })
    assert.deepEqual([rb.body.status, rb.body.refund ?? 0, stored(b.body.jobId)], ['IN_QUEUE', 0, 'IN_QUEUE'])
    assert.equal(t.rows("SELECT COUNT(*) AS n FROM ledger WHERE kind = 'refund'")[0].n, 0)
    // fal répond de nouveau : l'utilisateur réannule, l'annulation est confirmée, il est remboursé (une seule fois).
    t.fal = 'IN_QUEUE'
    t.onCancel = null
    for (const j of [a, b]) {
      const again = await t.as('user_alice', `/jobs/${j.body.jobId}/cancel`, { method: 'POST' })
      assert.deepEqual([again.body.status, again.body.refund], ['CANCELED', j.body.cost])
    }
    assert.equal((await t.as('user_alice', `/jobs/${a.body.jobId}/cancel`, { method: 'POST' })).body.status, 'CANCELED') // déjà annulée : rien de plus
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, 240)
    // Commencée d'après le dernier suivi et annulation en échec : annulée ici, sans remboursement (rien n'était dû).
    t.fal = 'IN_PROGRESS'
    const e = await t.as('user_alice', '/jobs', post(image))
    await t.as('user_alice', `/jobs/${e.body.jobId}`)
    t.fal = 'DOWN'
    t.onCancel = refused
    const re = await t.as('user_alice', `/jobs/${e.body.jobId}/cancel`, { method: 'POST' })
    assert.deepEqual([re.body.status, re.body.refund], ['CANCELED', 0])
    // État illisible, commencée d'après le dernier suivi : pas de remboursement même si fal accepte l'annulation.
    t.fal = 'IN_PROGRESS'
    t.onCancel = null
    const c = await t.as('user_alice', '/jobs', post(image))
    await t.as('user_alice', `/jobs/${c.body.jobId}`)
    t.fal = 'DOWN'
    const rc = await t.as('user_alice', `/jobs/${c.body.jobId}/cancel`, { method: 'POST' })
    assert.deepEqual([rc.body.status, rc.body.refund], ['CANCELED', 0])
    assert.equal((await t.as('user_alice', '/wallet')).body.balance, Math.round((240 - e.body.cost - c.body.cost) * 10) / 10)
    // État illisible, encore en file d'après le dernier suivi, annulation confirmée par fal : remboursée.
    const d = await t.as('user_alice', '/jobs', post(image))
    const rd = await t.as('user_alice', `/jobs/${d.body.jobId}/cancel`, { method: 'POST' })
    assert.deepEqual([rd.body.status, rd.body.refund], ['CANCELED', d.body.cost])
  } finally { t.restore() }
})

test('annulation de l\'utilisateur chez Higgsfield : « déjà commencée » (400) n\'est pas une annulation confirmée, pas de remboursement', async () => {
  const t = setup({ HIGGSFIELD_KEY: 'id:secret' })
  const inner = globalThis.fetch
  let answer = 400
  const calls = []
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (!u.startsWith('https://api.higgsfield.ai/')) return inner(url, init)
    calls.push(u)
    if (u.endsWith('/status')) return Response.json({ detail: 'surcharge' }, { status: 503 }) // état illisible
    return answer === 200 ? Response.json({ status: 'canceled' }) : Response.json({ detail: 'already started' }, { status: answer })
  }
  const acct = async (path, body) => (await t.account('user_alice').fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) }))).json()
  const queuedJob = async (id) => {
    await acct('/debit', { jobId: id, amount: 10 })
    await acct('/job/put', { id, kind: 'tool', provider: 'higgsfield', status: 'IN_QUEUE', cost: 10, requestId: id, cancelUrl: `https://api.higgsfield.ai/requests/${id}/cancel` })
  }
  try {
    const start = (await t.as('user_alice', '/wallet')).body.balance
    await queuedJob('h1')
    const no = await t.as('user_alice', '/jobs/h1/cancel', { method: 'POST' })
    assert.deepEqual([no.body.status, no.body.refund, no.body.balance], ['CANCELED', 0, start - 10])
    answer = 409 // déjà finie
    await queuedJob('h2')
    assert.equal((await t.as('user_alice', '/jobs/h2/cancel', { method: 'POST' })).body.refund, 0)
    answer = 200 // encore en file : annulée et remboursée par Higgsfield
    await queuedJob('h3')
    const yes = await t.as('user_alice', '/jobs/h3/cancel', { method: 'POST' })
    assert.deepEqual([yes.body.status, yes.body.refund, yes.body.balance], ['CANCELED', 10, start - 20])
    assert.equal(calls.filter((u) => u.endsWith('/cancel')).length, 3)
  } finally { globalThis.fetch = inner; t.restore() }
})

test('Durable Object : l\'annulation de l\'utilisateur ne rembourse que sur `refundable` et en file ; celle de l\'administration, toujours', async () => {
  const m = new Map()
  const acct = new Account({ storage: { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)) } } }, { ENV: 'dev' })
  const call = async (path, body) => (await acct.fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) }))).json()
  const put = async (id, status) => { await call('/debit', { jobId: id, amount: 10 }); await call('/job/put', { id, status, cost: 10 }) }
  await put('a', 'IN_QUEUE')
  assert.equal((await call('/job/cancel', { jobId: 'a', user: true })).refunded, 0) // l'état enregistré seul ne suffit plus
  await put('b', 'IN_QUEUE')
  assert.equal((await call('/job/cancel', { jobId: 'b', user: true, refundable: true })).refunded, 10)
  await put('c', 'IN_PROGRESS')
  assert.equal((await call('/job/cancel', { jobId: 'c', user: true, refundable: true })).refunded, 0) // commencée entre-temps
  await put('d', 'IN_PROGRESS')
  assert.equal((await call('/job/cancel', { jobId: 'd', reason: 'x', actor: 'adm' })).refunded, 10)
})

test('annulation par l\'administration d\'une génération commencée chez fal : toujours remboursée (inchangé)', async () => {
  const t = setup()
  try {
    const job = await t.as('user_alice', '/jobs', post(image))
    t.fal = 'IN_PROGRESS'
    const r = await t.admin(`/admin/users/user_alice/jobs/${job.body.jobId}/cancel`, post({ key: key(), reason: 'Bloquée chez fal' }))
    assert.deepEqual([r.status, r.body.outcome, r.body.refunded, r.body.balance, r.body.job.status], [200, 'canceled', job.body.cost, 240, 'CANCELED'])
    assert.equal(t.cancels.length, 1)
  } finally { t.restore() }
})
