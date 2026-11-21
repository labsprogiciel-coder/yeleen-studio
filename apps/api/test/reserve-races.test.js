import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account-do.js'
import app from '../src/index.js'
import { resetUserCache } from '../src/users.js'
import { testD1 } from './d1.js'

beforeEach(() => resetUserCache())

const MIN = 60_000

/**
 * Comme reserve.test.js : le vrai Account, une vraie base D1 et un faux fal (qui peut être asynchrone, pour glisser un événement
 * au milieu d'un envoi). `once.read` : appelé une fois, juste après la prochaine lecture d'une génération dans le stockage (un autre
 * événement du compte passe entre la lecture et la suite).
 */
function setup(fal, vars = {}) {
  const store = new Map()
  const db = testD1()
  let alarm = null
  const once = { read: null }
  const storage = {
    get: async (k) => {
      const v = structuredClone(store.get(k))
      if (once.read && k.startsWith('job:')) { const f = once.read; once.read = null; await f() }
      return v
    },
    put: async (k, v) => { store.set(k, structuredClone(v)) },
    getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t },
  }
  const env = { FAL_KEY: 'test', ENV: 'dev', DB: db, ALLOWED_ORIGINS: 'http://localhost:5174', ...vars }
  const account = new Account({ storage }, env)
  env.ACCOUNT = { idFromName: (n) => n, get: () => ({ fetch: (url, init) => account.fetch(new Request(url, init)) }) }
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
  const json = async (path, init) => { const res = await app.fetch(new Request(`http://api${path}`, init), env); return { status: res.status, body: await res.json() } }
  const acct = async (path, body) => {
    const res = await account.fetch(new Request(`https://account${path}`, { method: 'POST', headers: { 'x-account': 'demo' }, body: JSON.stringify(body) }))
    return { status: res.status, body: await res.json() }
  }
  return {
    json, acct, calls, store, once, ahead: (ms) => { shift += ms },
    wake: async () => { alarm = null; await account.alarm() },
    balance: async () => (await json('/wallet')).body.balance,
    active: () => Object.keys(store.get('active') ?? {}),
    jobId: () => [...store.keys()].find((k) => k.startsWith('job:')).slice(4),
    count: (kind) => db.raw.prepare(`SELECT * FROM ledger WHERE kind = '${kind}'`).all().length,
    restore: () => { globalThis.fetch = realFetch; Date.now = realNow },
  }
}
const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const image = { kind: 'image', modelId: 'nano-banana-pro', prompt: 'un chat', resolution: '1K', count: 1 }
const urls = { statusUrl: 'https://queue.fal.run/x/requests/r1/status', responseUrl: 'https://queue.fal.run/x/requests/r1', cancelUrl: 'https://queue.fal.run/x/requests/r1/cancel' }
const queued = { request_id: 'r1', status_url: urls.statusUrl, response_url: urls.responseUrl, cancel_url: urls.cancelUrl }
const pngs = { images: [{ url: 'https://cdn/x.png', content_type: 'image/png', width: 1, height: 1 }] }
const draft = (id) => ({ id, kind: 'image', modelId: 'nano-banana-pro', provider: 'fal', endpoint: 'x', cost: 10, count: 1, status: 'IN_QUEUE', submitting: true, origin: 'http://api', createdAt: Date.now() })
const isSubmit = (url) => url.includes('/nano-banana-pro')

test('réveil qui a lu la réservation juste avant son enregistrement par la route : la génération envoyée n’est pas échouée', async () => {
  const t = setup((url) => ({ body: url.includes('/status') ? { status: 'IN_QUEUE' } : {} }))
  try {
    const start = await t.balance()
    const { submitting, ...sent } = draft('j1')
    await t.acct('/job/reserve', { key: null, max: 6, job: draft('j1') })
    t.ahead(3.5 * MIN) // délai d'envoi dépassé, mais la route arrive avant le réveil
    t.once.read = () => t.acct('/job/put', { ...sent, ...urls })
    await t.wake()
    const job = t.store.get('job:j1')
    assert.deepEqual([job.status, job.failure, job.submitting], ['IN_QUEUE', undefined, undefined])
    assert.equal(t.count('refund'), 0)
    assert.equal(await t.balance(), start - 10)
    assert.deepEqual(t.active(), ['j1'])
  } finally { t.restore() }
})

test('envoi accepté après le délai mais avant le réveil : la génération suit son cours', async () => {
  let t
  t = setup((url) => {
    if (isSubmit(url)) { t.ahead(3.5 * MIN); return { body: queued } }
    return { body: url.includes('/status') ? { status: 'IN_QUEUE' } : {} }
  })
  try {
    const start = await t.balance()
    const res = await t.json('/jobs', post(image))
    assert.deepEqual([res.status, res.body.status], [202, 'IN_QUEUE'])
    await t.wake()
    assert.equal(t.store.get(`job:${res.body.jobId}`).status, 'IN_QUEUE')
    assert.equal(t.count('refund'), 0)
    assert.equal(await t.balance(), start - res.body.cost)
    assert.deepEqual(t.active(), [res.body.jobId])
  } finally { t.restore() }
})

test('annulation par l’administration pendant l’envoi : un seul remboursement, la route n’écrase rien et annule chez le fournisseur', async () => {
  let t
  t = setup(async (url) => {
    if (isSubmit(url)) { await t.acct('/job/cancel', { jobId: t.jobId(), reason: 'test', actor: 'adm', key: 'adm_12345678' }); return { body: queued } }
    return { body: {} }
  })
  try {
    const start = await t.balance()
    const res = await t.json('/jobs', post({ ...image, requestId: 'req-admin-01' }))
    assert.deepEqual([res.status, res.body.status, res.body.balance], [200, 'CANCELED', start])
    assert.ok(t.calls.includes(queued.cancel_url))
    assert.equal(t.store.get(`job:${res.body.jobId}`).status, 'CANCELED')
    assert.deepEqual([t.count('debit'), t.count('refund')], [1, 1])
    assert.deepEqual(t.active(), [])
    // Même clé ensuite : la même génération annulée, sans nouveau débit ni nouvel envoi.
    const sent = t.calls.length
    const again = await t.json('/jobs', post({ ...image, requestId: 'req-admin-01' }))
    assert.deepEqual([again.status, again.body.jobId, again.body.status, again.body.deduped], [200, res.body.jobId, 'CANCELED', true])
    assert.deepEqual([t.count('debit'), t.calls.length], [1, sent])
    assert.equal(await t.balance(), start)
  } finally { t.restore() }
})

test('envoi qui échoue après l’échec par le réveil : un seul remboursement', async () => {
  let t
  t = setup(async (url) => {
    if (isSubmit(url)) { t.ahead(4 * MIN); await t.wake(); return { status: 500, body: { detail: 'boom' } } }
    return { body: {} }
  })
  try {
    const start = await t.balance()
    const res = await t.json('/jobs', post(image))
    assert.deepEqual([res.status, res.body.error, res.body.balance], [502, 'provider', start])
    assert.ok(res.body.refunded > 0)
    assert.equal(t.store.get(`job:${t.jobId()}`).failure, 'timeout') // l'échec du réveil reste
    assert.deepEqual([t.count('debit'), t.count('refund')], [1, 1])
    assert.equal(await t.balance(), start)
    assert.deepEqual(t.active(), [])
  } finally { t.restore() }
})

test('même clé pendant l’envoi puis après la fin : une seule génération, un seul débit, un seul envoi', async () => {
  let t
  let during
  t = setup(async (url) => {
    if (isSubmit(url)) { during = await t.json('/jobs', post({ ...image, requestId: 'req-double-1' })); return { body: queued } }
    return { body: url.includes('/status') ? { status: 'COMPLETED' } : pngs }
  })
  try {
    const start = await t.balance()
    const res = await t.json('/jobs', post({ ...image, requestId: 'req-double-1' }))
    assert.deepEqual([res.status, during.status, during.body.jobId, during.body.status, during.body.deduped], [202, 202, res.body.jobId, 'IN_QUEUE', true])
    assert.equal((await t.json(`/jobs/${res.body.jobId}`)).body.status, 'COMPLETED')
    const after = await t.json('/jobs', post({ ...image, requestId: 'req-double-1' }))
    assert.deepEqual([after.status, after.body.jobId, after.body.status, after.body.outputs.length], [200, res.body.jobId, 'COMPLETED', 1])
    assert.equal(t.calls.filter(isSubmit).length, 1)
    assert.deepEqual([t.count('debit'), t.count('refund')], [1, 0])
    assert.equal(await t.balance(), start - res.body.cost)
  } finally { t.restore() }
})
