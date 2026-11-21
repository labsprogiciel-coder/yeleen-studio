import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account-do.js'
import app from '../src/index.js'
import { resetUserCache } from '../src/users.js'
import { testD1 } from './d1.js'

beforeEach(() => resetUserCache())

const MIN = 60_000
const HOUR = 60 * MIN

/**
 * L'API avec le vrai Account (stockage en mémoire, alarmes comprises), une vraie base D1 et un faux fal (qui peut être asynchrone).
 * `ahead(ms)` avance l'horloge ; `broken.put = true` fait tomber l'appel `/job/put` de la route (comme une route interrompue).
 */
function setup(fal, vars = {}) {
  const store = new Map()
  const db = testD1()
  let alarm = null
  const storage = {
    get: async (k) => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)) },
    getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t },
  }
  const env = { FAL_KEY: 'test', ENV: 'dev', DB: db, ALLOWED_ORIGINS: 'http://localhost:5174', ...vars }
  const account = new Account({ storage }, env)
  const broken = { put: false }
  env.ACCOUNT = { idFromName: (n) => n, get: () => ({ fetch: (url, init) => {
    if (broken.put && String(url).endsWith('/job/put')) throw new Error('route interrompue')
    return account.fetch(new Request(url, init))
  } }) }
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    const r = await fal(String(url), init)
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }
  const realNow = Date.now
  let shift = 0
  Date.now = () => realNow() + shift
  const req = (path, init) => app.fetch(new Request(`http://api${path}`, init), env)
  const json = async (path, init) => { const res = await req(path, init); return { status: res.status, body: await res.json() } }
  // Appel direct du Durable Object du compte `demo`.
  const acct = async (path, body) => {
    const res = await account.fetch(new Request(`https://account${path}`, { method: 'POST', headers: { 'x-account': 'demo' }, body: JSON.stringify(body) }))
    return { status: res.status, body: await res.json() }
  }
  // Un réveil : comme le runtime, l'alarme est consommée avant l'appel.
  const wake = async () => { alarm = null; await account.alarm() }
  return {
    req, json, acct, calls, store, wake, broken, alarm: () => alarm, ahead: (ms) => { shift += ms },
    balance: async () => (await json('/wallet')).body.balance,
    active: () => Object.keys(store.get('active') ?? {}),
    rows: (sql) => db.raw.prepare(sql).all(),
    restore: () => { globalThis.fetch = realFetch; Date.now = realNow },
  }
}
const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const image = { kind: 'image', modelId: 'nano-banana-pro', prompt: 'un chat', resolution: '1K', count: 1 }
const urls = (n) => ({ statusUrl: `https://queue.fal.run/x/requests/${n}/status`, responseUrl: `https://queue.fal.run/x/requests/${n}`, cancelUrl: `https://queue.fal.run/x/requests/${n}/cancel` })
const queued = { request_id: 'r1', status_url: urls('r1').statusUrl, response_url: urls('r1').responseUrl, cancel_url: urls('r1').cancelUrl }
const pngs = { images: [{ url: 'https://cdn/x.png', content_type: 'image/png', width: 1, height: 1 }] }
// Une réservation telle que la route l'écrit (pas encore envoyée au fournisseur).
const draft = (id, more = {}) => ({ id, kind: 'image', modelId: 'nano-banana-pro', provider: 'fal', endpoint: 'x', cost: 10, count: 1, status: 'IN_QUEUE', submitting: true, origin: 'http://api', createdAt: Date.now(), ...more })

test('route interrompue après la réservation : la génération existe, puis le réveil la fait échouer et la rembourse', async () => {
  const t = setup(() => ({ body: queued }))
  try {
    const start = await t.balance()
    t.broken.put = true
    assert.ok((await t.req('/jobs', post(image))).status >= 500)
    t.broken.put = false
    const id = [...t.store.keys()].find((k) => k.startsWith('job:')).slice(4)
    assert.ok((await t.balance()) < start) // débité…
    const seen = await t.json(`/jobs/${id}`)
    assert.deepEqual([seen.status, seen.body.status], [200, 'IN_QUEUE']) // … mais la génération existe
    assert.deepEqual(t.active(), [id])
    assert.equal(t.rows('SELECT status FROM jobs')[0].status, 'IN_QUEUE') // visible de l'administration
    assert.ok(t.alarm()) // réveil programmé dès la réservation

    await t.wake() // trop tôt : la route peut encore être en train d'envoyer
    assert.deepEqual(t.active(), [id])
    t.ahead(4 * MIN)
    await t.wake()
    const done = await t.json(`/jobs/${id}`)
    assert.deepEqual([done.body.status, done.body.failure], ['FAILED', 'provider']) // `timeout` présenté comme `provider`
    assert.equal(done.body.balance, start)
    assert.deepEqual({ ...t.rows('SELECT status, failure FROM jobs')[0] }, { status: 'FAILED', failure: 'timeout' })
    assert.deepEqual(t.rows('SELECT kind FROM ledger WHERE ref = ? ORDER BY kind'.replace('?', `'${id}'`)).map((l) => l.kind), ['debit', 'refund'])
    assert.deepEqual(t.active(), [])
    assert.equal(t.alarm(), null)
  } finally { t.restore() }
})

test('réservation : solde insuffisant, places prises et compte bloqué n’écrivent rien ; même clé, même génération', async () => {
  const t = setup(() => ({ body: {} }))
  try {
    const start = await t.balance()
    const poor = await t.acct('/job/reserve', { key: 'cle-pauvre-1', max: 6, job: draft('j0', { cost: start + 1 }) })
    assert.deepEqual([poor.status, poor.body.error, poor.body.missing], [402, 'insufficient', 1])
    assert.equal(t.store.get('job:j0'), undefined)
    assert.equal(t.store.get('idem:cle-pauvre-1'), undefined)
    assert.deepEqual(t.active(), [])

    const a = await t.acct('/job/reserve', { key: 'cle-12345678', max: 1, job: draft('j1') })
    assert.deepEqual([a.status, a.body.ok, a.body.balance], [200, true, start - 10])
    assert.equal(t.store.get('job:j1').submitting, true)
    const again = await t.acct('/job/reserve', { key: 'cle-12345678', max: 1, job: draft('j2') })
    assert.deepEqual([again.body.existing, again.body.job.id, again.body.balance], ['j1', 'j1', start - 10]) // un seul débit
    assert.equal(t.store.get('job:j2'), undefined)

    const full = await t.acct('/job/reserve', { key: null, max: 1, job: draft('j3') })
    assert.deepEqual([full.status, full.body.error], [429, 'too_many_active'])
    assert.equal(t.store.get('job:j3'), undefined)
    assert.equal(await t.balance(), start - 10)

    await t.acct('/admin/block', { blocked: true, reason: 'test', actor: 'adm' })
    const blocked = await t.acct('/job/reserve', { key: 'cle-12345678', max: 6, job: draft('j4') })
    assert.deepEqual([blocked.status, blocked.body.error], [403, 'account_blocked'])
  } finally { t.restore() }
})

test('échec à l’envoi puis nouvel essai avec la même clé : la génération échouée est rendue, sans second envoi', async () => {
  const t = setup(() => ({ status: 500, body: { detail: 'boom' } }))
  try {
    const start = await t.balance()
    const first = await t.json('/jobs', post({ ...image, requestId: 'req-12345678' }))
    assert.deepEqual([first.status, first.body.error, first.body.balance], [502, 'provider', start])
    assert.ok(first.body.refunded > 0)
    const sent = t.calls.length

    const retry = await t.json('/jobs', post({ ...image, requestId: 'req-12345678' }))
    assert.deepEqual([retry.status, retry.body.status, retry.body.failure, retry.body.deduped], [200, 'FAILED', 'provider', true])
    assert.equal(retry.body.refund, first.body.refunded)
    assert.equal(retry.body.cost, first.body.refunded)
    assert.equal(retry.body.balance, start)
    assert.equal(t.calls.length, sent) // fal n'est pas rappelé

    const seen = await t.json(`/jobs/${retry.body.jobId}`)
    assert.deepEqual([seen.status, seen.body.status, seen.body.refund], [200, 'FAILED', first.body.refunded])
    assert.deepEqual(t.active(), [])
    assert.equal(t.rows('SELECT status FROM jobs')[0].status, 'FAILED')
  } finally { t.restore() }
})

test('envoi plus long que le délai : le réveil a déjà remboursé, la route n’écrase rien et annule chez le fournisseur', async () => {
  let t
  t = setup(async (url) => {
    if (url.includes('/nano-banana-pro')) { t.ahead(4 * MIN); await t.wake(); return { body: queued } }
    return { body: {} }
  })
  try {
    const start = await t.balance()
    const res = await t.json('/jobs', post(image))
    assert.deepEqual([res.status, res.body.status, res.body.failure, res.body.balance], [200, 'FAILED', 'provider', start])
    assert.ok(t.calls.includes(queued.cancel_url))
    const stored = t.store.get(`job:${res.body.jobId}`)
    assert.deepEqual([stored.status, stored.failure], ['FAILED', 'timeout'])
    assert.equal(t.rows('SELECT * FROM ledger WHERE kind = \'refund\'').length, 1)
    assert.equal(await t.balance(), start)
    assert.deepEqual(t.active(), [])
  } finally { t.restore() }
})

test('fournisseur qui ne répond jamais : échec remboursé au bout d’une heure (image) ou de deux (vidéo), et un résultat tardif est ignoré', async () => {
  let late = false
  const t = setup((url) => {
    if (url.includes('/nano-banana-pro')) return { body: queued }
    if (url.includes('/status')) return late ? { body: { status: 'COMPLETED' } } : { status: 404, body: { detail: 'not found' } }
    if (url.endsWith('/cancel')) return { body: {} }
    return { body: pngs }
  })
  try {
    const start = await t.balance()
    const { jobId } = (await t.json('/jobs', post(image))).body
    // Une vidéo, enregistrée directement (son envoi n'est pas le sujet).
    await t.acct('/debit', { jobId: 'v1', amount: 20 })
    await t.acct('/job/put', { id: 'v1', kind: 'video', modelId: 'm', provider: 'fal', cost: 20, count: 1, status: 'IN_QUEUE', origin: 'http://api', createdAt: Date.now(), ...urls('v1') })

    t.ahead(30 * MIN)
    await t.wake()
    assert.deepEqual(t.active().sort(), [jobId, 'v1'].sort()) // dans les temps : toujours suivies

    t.ahead(31 * MIN)
    await t.wake()
    assert.deepEqual([t.store.get(`job:${jobId}`).status, t.store.get(`job:${jobId}`).failure], ['FAILED', 'timeout'])
    assert.ok(t.calls.includes(queued.cancel_url)) // annulation tentée chez fal
    assert.equal(t.rows(`SELECT status, failure FROM jobs WHERE id = '${jobId}'`)[0].status, 'FAILED')
    assert.equal(t.rows(`SELECT * FROM ledger WHERE kind = 'refund' AND ref = '${jobId}'`).length, 1)
    assert.equal(await t.balance(), start - 20)
    assert.deepEqual(t.active(), ['v1']) // la vidéo a deux heures
    assert.ok(t.alarm())

    // Résultat tardif : la génération remboursée reste échouée, sans fichiers.
    late = true
    const before = t.calls.length
    const seen = await t.json(`/jobs/${jobId}`)
    assert.deepEqual([seen.body.status, seen.body.failure, seen.body.outputs], ['FAILED', 'provider', undefined])
    assert.equal(t.calls.length, before)
    const put = await t.acct('/job/put', { ...t.store.get(`job:${jobId}`), status: 'COMPLETED', outputs: [{ url: 'https://cdn/x.png' }] })
    assert.deepEqual([put.status, put.body.error], [409, 'terminal'])
    assert.equal(await t.balance(), start - 20)
    late = false

    t.ahead(60 * MIN)
    await t.wake()
    assert.deepEqual([t.store.get('job:v1').status, t.store.get('job:v1').failure, t.store.get('job:v1').refund], ['FAILED', 'timeout', 20])
    assert.equal(await t.balance(), start)
    assert.deepEqual(t.active(), [])
    assert.equal(t.alarm(), null)
  } finally { t.restore() }
})

test('aucun oubli silencieux : une vieille génération que le réveil ne peut pas suivre (sans origine) est échouée et remboursée', async () => {
  const t = setup(() => ({ body: {} }), { FILES: {} })
  try {
    const start = await t.balance()
    await t.acct('/debit', { jobId: 'old', amount: 15 })
    await t.acct('/job/put', { id: 'old', kind: 'image', modelId: 'm', provider: 'fal', cost: 15, count: 1, status: 'IN_QUEUE', createdAt: Date.now(), ...urls('old') })
    await t.wake()
    assert.deepEqual(t.active(), ['old']) // récente : laissée à l'interface, comme avant
    assert.equal(t.calls.length, 0)

    t.ahead(4 * HOUR)
    await t.wake()
    const job = t.store.get('job:old')
    assert.deepEqual([job.status, job.failure, job.refund], ['FAILED', 'timeout', 15])
    assert.equal(await t.balance(), start)
    assert.deepEqual(t.active(), [])
    assert.equal(t.alarm(), null)
  } finally { t.restore() }
})

test('réservations de l’ancien protocole : place sans génération remboursée et rendue après le délai d’envoi ; génération suivie comme avant', async () => {
  const phase = { v: 'queue' }
  const t = setup((url) => (url.includes('/status') ? { body: { status: phase.v === 'queue' ? 'IN_QUEUE' : 'COMPLETED' } } : { body: pngs }))
  try {
    const start = await t.balance()
    // Ancienne route arrêtée entre le débit et l'enregistrement : une place et un débit, pas de génération.
    await t.acct('/job/claim', { key: 'vieille-cle-1', jobId: 'orphan', max: 6 })
    await t.acct('/debit', { jobId: 'orphan', amount: 12 })
    // Ancienne route arrêtée avant le débit : une place seulement.
    await t.acct('/job/claim', { key: null, jobId: 'empty', max: 6 })
    // Ancienne génération, envoyée (sans `submitting`).
    await t.acct('/debit', { jobId: 'sent', amount: 5 })
    await t.acct('/job/put', { id: 'sent', kind: 'image', modelId: 'm', provider: 'fal', cost: 5, count: 1, status: 'IN_QUEUE', origin: 'http://api', createdAt: Date.now(), ...urls('sent') })

    // Même clé pendant que l'ancienne route est peut-être encore en cours : répondu comme avant, sans nouveau débit.
    const dup = await t.json('/jobs', post({ ...image, requestId: 'vieille-cle-1' }))
    assert.deepEqual([dup.status, dup.body.jobId, dup.body.status, dup.body.deduped], [202, 'orphan', 'IN_QUEUE', true])

    t.ahead(MIN)
    await t.wake()
    assert.deepEqual(t.active().sort(), ['empty', 'orphan', 'sent']) // moins de 3 min : rien n'est touché
    assert.equal(await t.balance(), start - 17)

    t.ahead(3 * MIN)
    phase.v = 'done'
    await t.wake()
    assert.deepEqual(t.active(), [])
    assert.equal(await t.balance(), start - 5) // l'orpheline est remboursée, la génération envoyée reste payée
    assert.equal(t.rows('SELECT * FROM ledger WHERE kind = \'refund\' AND ref = \'orphan\'').length, 1)
    assert.equal(t.store.get('job:sent').status, 'COMPLETED')
    assert.equal(t.alarm(), null)

    // La clé de l'orpheline est reprise par une nouvelle réservation.
    const fresh = await t.acct('/job/reserve', { key: 'vieille-cle-1', max: 6, job: draft('fresh') })
    assert.deepEqual([fresh.body.ok, fresh.body.existing], [true, undefined])
    assert.equal(t.store.get('idem:vieille-cle-1'), 'fresh')
  } finally { t.restore() }
})

test('annulation pendant l’envoi : la réservation reste en file, sans remboursement ni appel au fournisseur', async () => {
  const t = setup(() => ({ body: {} }))
  try {
    const start = await t.balance()
    await t.acct('/job/reserve', { key: null, max: 6, job: draft('j1') })
    const out = await t.json('/jobs/j1/cancel', { method: 'POST' })
    assert.deepEqual([out.status, out.body.status, out.body.refund, out.body.balance], [200, 'IN_QUEUE', 0, start - 10])
    assert.equal(t.calls.length, 0)
    assert.equal(t.store.get('job:j1').submitting, true)
    assert.deepEqual(t.active(), ['j1'])
  } finally { t.restore() }
})
