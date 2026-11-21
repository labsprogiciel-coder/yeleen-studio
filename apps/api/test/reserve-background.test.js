import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account-do.js'
import app from '../src/index.js'
import { resetUserCache } from '../src/users.js'
import { testD1 } from './d1.js'

beforeEach(() => resetUserCache())

const MIN = 60_000

/**
 * Comme reserve.test.js, avec un contexte d'exécution : `waits` reçoit ce que la route confie à waitUntil.
 * `drop(path, init)` joue un client qui coupe : la réponse de la route n'est jamais attendue ni lue, on attend seulement que la
 * route ait confié sa suite à waitUntil (ou qu'elle ait fini sans rien confier), puis le test attend `waits` comme le runtime.
 * `ctx: false` : pas de contexte d'exécution ; `ctx: 'broken'` : un contexte dont waitUntil lève.
 */
function setup(fal, { ctx: withCtx = true } = {}) {
  const store = new Map()
  const db = testD1()
  let alarm = null
  const storage = {
    get: async (k) => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)) },
    getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t },
  }
  const env = { FAL_KEY: 'test', ENV: 'dev', DB: db, ALLOWED_ORIGINS: 'http://localhost:5174' }
  const account = new Account({ storage }, env)
  const broken = { put: false }
  env.ACCOUNT = { idFromName: (n) => n, get: () => ({ fetch: (url, init) => {
    if (broken.put && String(url).endsWith('/job/put')) throw new Error('enregistrement impossible')
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
  const waits = []
  let registered
  const seen = new Promise((ok) => { registered = ok })
  const ctx = withCtx === 'broken' ? { waitUntil: () => { throw new Error('contexte fermé') }, passThroughOnException() {} }
    : withCtx ? { waitUntil: (p) => { waits.push(p); registered() }, passThroughOnException() {} } : undefined
  const req = (path, init) => app.fetch(new Request(`http://api${path}`, init), env, ctx)
  const json = async (path, init) => { const res = await req(path, init); return { status: res.status, body: await res.json() } }
  return {
    req, json, calls, store, waits, broken, ahead: (ms) => { shift += ms },
    drop: async (path, init) => { const gone = Promise.resolve(req(path, init)).then(() => {}, () => {}); await Promise.race([seen, gone]) },
    wake: async () => { alarm = null; await account.alarm() },
    balance: async () => (await json('/wallet')).body.balance,
    active: () => Object.keys(store.get('active') ?? {}),
    job: () => [...store.entries()].find(([k]) => k.startsWith('job:'))[1],
    count: (kind) => db.raw.prepare(`SELECT * FROM ledger WHERE kind = '${kind}'`).all().length,
    restore: () => { globalThis.fetch = realFetch; Date.now = realNow },
  }
}
const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const image = { kind: 'image', modelId: 'nano-banana-pro', prompt: 'un chat', resolution: '1K', count: 1 }
const urls = { statusUrl: 'https://queue.fal.run/x/requests/r1/status', responseUrl: 'https://queue.fal.run/x/requests/r1', cancelUrl: 'https://queue.fal.run/x/requests/r1/cancel' }
const queued = { request_id: 'r1', status_url: urls.statusUrl, response_url: urls.responseUrl, cancel_url: urls.cancelUrl }
const isSubmit = (url) => url.includes('/nano-banana-pro')
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms))

test('client parti pendant l’envoi : la suite confiée à waitUntil enregistre la génération, sans remboursement', async () => {
  const t = setup(async (url) => {
    if (isSubmit(url)) { await pause(20); return { body: queued } }
    return { body: url.includes('/status') ? { status: 'IN_QUEUE' } : {} }
  })
  try {
    const start = await t.balance()
    await t.drop('/jobs', post(image))
    assert.equal(t.waits.length, 1) // la suite est confiée au runtime
    assert.equal(t.job().submitting, true) // l'envoi est encore en cours
    await Promise.all(t.waits)
    assert.equal(t.calls.filter(isSubmit).length, 1)
    const job = t.job()
    assert.deepEqual([job.status, job.submitting, job.requestId, job.statusUrl, job.cancelUrl], ['IN_QUEUE', undefined, 'r1', urls.statusUrl, urls.cancelUrl])
    assert.equal(t.count('refund'), 0)
    assert.equal(await t.balance(), start - job.cost)

    t.ahead(4 * MIN) // délai d'envoi passé : le réveil la suit, il ne la fait pas échouer
    await t.wake()
    assert.deepEqual([t.job().status, t.job().failure], ['IN_QUEUE', undefined])
    assert.equal(t.count('refund'), 0)
    assert.deepEqual(t.active(), [job.id])
    assert.equal(t.calls.filter(isSubmit).length, 1)
  } finally { t.restore() }
})

test('client parti et envoi refusé par le fournisseur : génération échouée, remboursée une seule fois', async () => {
  const t = setup(async (url) => {
    if (isSubmit(url)) { await pause(20); return { status: 500, body: { detail: 'boom' } } }
    return { body: {} }
  })
  try {
    const start = await t.balance()
    await t.drop('/jobs', post(image))
    assert.equal(t.waits.length, 1)
    await Promise.all(t.waits) // jamais rejetée
    assert.equal(t.calls.filter(isSubmit).length, 1)
    assert.deepEqual([t.job().status, t.job().failure], ['FAILED', 'provider'])
    assert.equal(t.count('refund'), 1)
    assert.equal(await t.balance(), start)
    assert.deepEqual(t.active(), [])

    t.ahead(4 * MIN)
    await t.wake()
    assert.equal(t.count('refund'), 1) // pas de second remboursement
    assert.equal(await t.balance(), start)
  } finally { t.restore() }
})

test('enregistrement impossible après l’envoi : la suite ne rejette pas dans waitUntil, la route répond toujours en erreur', async () => {
  const t = setup(() => ({ body: queued }))
  try {
    t.broken.put = true
    const res = await t.req('/jobs', post(image))
    assert.ok(res.status >= 500)
    assert.equal(t.waits.length, 1)
    await Promise.all(t.waits) // l'erreur est rendue à la route, pas au runtime
    assert.ok(t.calls.includes(urls.cancelUrl)) // annulation tentée chez le fournisseur
  } finally { t.restore() }
})

test('sans contexte d’exécution : la route envoie, enregistre et répond comme avant', async () => {
  const t = setup(() => ({ body: queued }), { ctx: false })
  try {
    const start = await t.balance()
    const res = await t.json('/jobs', post(image))
    assert.deepEqual([res.status, res.body.status, res.body.jobId, res.body.balance], [202, 'IN_QUEUE', t.job().id, start - res.body.cost])
    assert.deepEqual([t.job().submitting, t.job().requestId], [undefined, 'r1'])
    assert.equal(t.count('refund'), 0)
  } finally { t.restore() }
})

test('contexte d’exécution dont waitUntil échoue : la route répond quand même', async () => {
  const t = setup(() => ({ body: queued }), { ctx: 'broken' })
  try {
    const res = await t.json('/jobs', post(image))
    assert.deepEqual([res.status, res.body.status], [202, 'IN_QUEUE'])
    assert.equal(t.job().requestId, 'r1')
    assert.equal(t.count('refund'), 0)
  } finally { t.restore() }
})
