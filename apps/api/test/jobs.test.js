import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account-do.js'
import app from '../src/index.js'
import { sameToken, webhookToken } from '../src/jobs.js'

/** L'API avec le vrai Account (stockage en mémoire, alarmes comprises) et un faux fal ; `calls` : les adresses appelées. */
function setup(fal, vars = {}) {
  const store = new Map()
  let alarm = null
  const storage = {
    get: async (k) => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)) },
    getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t },
  }
  const env = { FAL_KEY: 'test', ENV: 'dev', ALLOWED_ORIGINS: 'http://localhost:5174', ...vars }
  const account = new Account({ storage }, env)
  env.ACCOUNT = { idFromName: (n) => n, get: () => ({ fetch: (url, init) => account.fetch(new Request(url, init)) }) }
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    const r = fal(String(url), init)
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }
  const req = (path, init) => app.fetch(new Request(`http://api${path}`, init), env)
  // Un réveil : comme le runtime, l'alarme est consommée avant l'appel.
  const wake = async () => { alarm = null; await account.alarm() }
  return { req, calls, wake, alarm: () => alarm, restore: () => { globalThis.fetch = real } }
}
const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const image = { kind: 'image', modelId: 'nano-banana-pro', prompt: 'un chat', resolution: '1K', count: 1 }
const queued = { request_id: 'r1', status_url: 'https://queue.fal.run/x/requests/r1/status', response_url: 'https://queue.fal.run/x/requests/r1', cancel_url: 'https://queue.fal.run/x/requests/r1/cancel' }
const falWith = (phase) => (url) => {
  if (url.includes('/nano-banana-pro')) return { body: queued }
  if (url.includes('/status')) return { body: { status: phase.v === 'queue' ? 'IN_QUEUE' : 'COMPLETED' } }
  if (phase.v === 'error') return { status: 422, body: { detail: [{ type: 'content_policy_violation' }] } }
  return { body: { images: [{ url: 'https://cdn/x.png', content_type: 'image/png', width: 1, height: 1 }] } }
}

test('jeton du webhook : propre à un compte et une génération', async () => {
  const t = await webhookToken('s3cret', 'demo', 'job-1')
  assert.match(t, /^[\w-]{43}$/)
  assert.ok(sameToken(t, await webhookToken('s3cret', 'demo', 'job-1')))
  assert.ok(!sameToken(t, await webhookToken('s3cret', 'demo', 'job-2')))
  assert.ok(!sameToken(t, await webhookToken('autre', 'demo', 'job-1')))
  assert.ok(!sameToken(t, undefined))
})

test('webhook fal : adresse signée à l’envoi ; à son appel la génération se termine sans l’interface', async () => {
  const phase = { v: 'queue' }
  const t = setup(falWith(phase), { WEBHOOK_SECRET: 's3cret' })
  try {
    const { jobId } = await (await t.req('/jobs', post(image))).json()
    const submitted = new URL(t.calls.find((u) => u.includes('/nano-banana-pro')))
    const hook = new URL(submitted.searchParams.get('fal_webhook'))
    assert.equal(hook.origin + hook.pathname, 'http://api/webhooks/fal')
    assert.equal(hook.searchParams.get('j'), jobId)

    phase.v = 'done'
    const res = await t.req(`${hook.pathname}${hook.search}`, post({ request_id: 'r1', status: 'OK', payload: { images: [{ url: 'https://evil/x.png' }] } }))
    assert.equal(res.status, 200)
    const before = t.calls.length
    const done = await (await t.req(`/jobs/${jobId}`)).json()
    assert.equal(done.status, 'COMPLETED')
    assert.equal(done.outputs[0].url, 'https://cdn/x.png') // relu chez fal, pas pris dans le corps du webhook
    assert.equal(t.calls.length, before) // déjà terminée : le suivi ne rappelle pas fal
  } finally { t.restore() }
})

test('webhook fal : jeton faux ou absent refusé sans toucher à la génération ; sans WEBHOOK_SECRET, pas de webhook', async () => {
  const phase = { v: 'queue' }
  const t = setup(falWith(phase), { WEBHOOK_SECRET: 's3cret' })
  try {
    const { jobId } = await (await t.req('/jobs', post(image))).json()
    const before = t.calls.length
    assert.equal((await t.req(`/webhooks/fal?a=demo&j=${jobId}&t=faux`, post({}))).status, 401)
    assert.equal((await t.req(`/webhooks/fal?a=demo&j=${jobId}`, post({}))).status, 401)
    assert.equal(t.calls.length, before)
  } finally { t.restore() }

  const u = setup(falWith({ v: 'queue' }))
  try {
    await u.req('/jobs', post(image))
    assert.equal(new URL(u.calls[0]).searchParams.get('fal_webhook'), null)
    assert.equal((await u.req('/webhooks/fal?a=demo&j=x&t=y', post({}))).status, 401)
  } finally { u.restore() }
})

test('réveil du compte : la génération avance seule, puis le réveil s’arrête', async () => {
  const phase = { v: 'queue' }
  const t = setup(falWith(phase))
  try {
    const { jobId } = await (await t.req('/jobs', post(image))).json()
    assert.ok(t.alarm() > Date.now()) // programmé dès l'envoi
    await t.wake()
    assert.ok(t.alarm()) // toujours en file : reprogrammé
    phase.v = 'done'
    await t.wake()
    assert.equal(t.alarm(), null) // plus rien d'actif
    const before = t.calls.length
    const done = await (await t.req(`/jobs/${jobId}`)).json()
    assert.equal(done.status, 'COMPLETED')
    assert.equal(t.calls.length, before)
  } finally { t.restore() }
})

test('réveil du compte : un échec est remboursé une seule fois, même si l’interface interroge aussi', async () => {
  const phase = { v: 'queue' }
  const t = setup(falWith(phase))
  try {
    const start = (await (await t.req('/wallet')).json()).balance
    const { jobId } = await (await t.req('/jobs', post(image))).json()
    phase.v = 'error'
    await t.wake()
    const seen = await (await t.req(`/jobs/${jobId}`)).json()
    assert.equal(seen.status, 'FAILED')
    assert.equal(seen.failure, 'moderation')
    await t.wake()
    assert.equal((await (await t.req('/wallet')).json()).balance, start)
  } finally { t.restore() }
})

test('réveil du compte : une panne passagère de fal ne fait pas échouer la génération', async () => {
  const phase = { v: 'queue' }
  let down = false
  const base = falWith(phase)
  const t = setup((url, init) => (down && url.includes('/status') ? { status: 503, body: { detail: 'down' } } : base(url, init)))
  try {
    const { jobId } = await (await t.req('/jobs', post(image))).json()
    down = true
    await t.wake()
    assert.ok(t.alarm()) // on réessaiera
    down = false
    phase.v = 'done'
    await t.wake()
    assert.equal((await (await t.req(`/jobs/${jobId}`)).json()).status, 'COMPLETED')
  } finally { t.restore() }
})
