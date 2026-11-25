import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account-do.js'
import app from '../src/index.js'
import { LEGACY_UNTIL } from '../src/legacy.js'
import { openWebhook, sameToken, sealWebhook, webhookToken } from '../src/jobs.js'

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

test('jeton opaque du webhook : s’ouvre seulement avec le bon secret, ne montre ni le compte ni la génération', async () => {
  const k = await sealWebhook('s3cret', 'user_alice', 'job-1')
  assert.match(k, /^[\w-]+$/)
  assert.ok(!k.includes('alice') && !atob(k.replace(/-/g, '+').replace(/_/g, '/')).includes('alice'))
  assert.notEqual(k, await sealWebhook('s3cret', 'user_alice', 'job-1')) // vecteur aléatoire : deux jetons différents
  assert.deepEqual(await openWebhook('s3cret', k), { accountId: 'user_alice', jobId: 'job-1' })
  assert.equal(await openWebhook('autre', k), null)
  // Un caractère changé (chiffré ou étiquette) : le contrôle d'intégrité échoue.
  for (const i of [0, 14, k.length - 2]) {
    const bad = k.slice(0, i) + (k[i] === 'A' ? 'B' : 'A') + k.slice(i + 1)
    assert.equal(await openWebhook('s3cret', bad), null, `position ${i}`)
  }
  for (const bad of [undefined, '', 'x', 'A'.repeat(60), k + '!', k.slice(0, 30)]) assert.equal(await openWebhook('s3cret', bad), null)
})

test('webhook fal : adresse signée à l’envoi ; à son appel la génération se termine sans l’interface', async () => {
  const phase = { v: 'queue' }
  const t = setup(falWith(phase), { WEBHOOK_SECRET: 's3cret' })
  try {
    const { jobId } = await (await t.req('/jobs', post(image))).json()
    const submitted = new URL(t.calls.find((u) => u.includes('/nano-banana-pro')))
    const hook = new URL(submitted.searchParams.get('fal_webhook'))
    assert.equal(hook.origin + hook.pathname, 'http://api/webhooks/fal')
    assert.deepEqual([...hook.searchParams.keys()], ['k']) // ni compte (`a`) ni génération (`j`) dans l'adresse
    assert.ok(!hook.href.includes('demo') && !hook.href.includes(jobId))
    assert.deepEqual(await openWebhook('s3cret', hook.searchParams.get('k')), { accountId: 'demo', jobId })

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
    // Jeton opaque fabriqué : autre secret, retouché, ou au hasard ; rien n'est relu chez fal.
    const k = new URL(new URL(t.calls.find((u) => u.includes('/nano-banana-pro'))).searchParams.get('fal_webhook')).searchParams.get('k')
    const forged = [await sealWebhook('autre', 'demo', jobId), k.slice(0, -1) + (k.endsWith('A') ? 'B' : 'A'), 'A'.repeat(k.length), '']
    for (const f of forged) assert.equal((await t.req(`/webhooks/fal?k=${f}`, post({}))).status, 401, f)
    // Un jeton valide ne s'ajoute pas à une ancienne forme fausse pour viser un autre compte : `k` seul décide.
    assert.equal((await t.req(`/webhooks/fal?k=${forged[0]}&a=demo&j=${jobId}&t=${await webhookToken('s3cret', 'demo', jobId)}`, post({}))).status, 401)
    assert.equal(t.calls.length, before)
  } finally { t.restore() }

  const u = setup(falWith({ v: 'queue' }))
  try {
    await u.req('/jobs', post(image))
    assert.equal(new URL(u.calls[0]).searchParams.get('fal_webhook'), null)
    assert.equal((await u.req('/webhooks/fal?a=demo&j=x&t=y', post({}))).status, 401)
    assert.equal((await u.req(`/webhooks/fal?k=${await sealWebhook('', 'demo', 'x')}`, post({}))).status, 401)
  } finally { u.restore() }
})

test('webhook fal : l’ancienne adresse (`a`, `j`, `t`) d’une génération envoyée avant le changement marche encore', async () => {
  const phase = { v: 'queue' }
  const t = setup(falWith(phase), { WEBHOOK_SECRET: 's3cret' })
  try {
    const { jobId } = await (await t.req('/jobs', post(image))).json()
    phase.v = 'done'
    const old = new URLSearchParams({ a: 'demo', j: jobId, t: await webhookToken('s3cret', 'demo', jobId) })
    assert.equal((await t.req(`/webhooks/fal?a=autre&j=${jobId}&t=${old.get('t')}`, post({}))).status, 401) // jeton d'un autre compte
    const before = t.calls.length
    assert.equal((await t.req(`/webhooks/fal?${old}`, post({}))).status, 200)
    assert.ok(t.calls.length > before) // relu chez fal
    assert.equal((await (await t.req(`/jobs/${jobId}`)).json()).status, 'COMPLETED')
  } finally { t.restore() }
})

test('webhook fal : après LEGACY_UNTIL, l’ancienne adresse est refusée, même bien signée ; le jeton opaque marche toujours', async () => {
  const phase = { v: 'queue' }
  const t = setup(falWith(phase), { WEBHOOK_SECRET: 's3cret' })
  const now = Date.now
  try {
    const { jobId } = await (await t.req('/jobs', post(image))).json()
    const k = new URL(new URL(t.calls.find((u) => u.includes('/nano-banana-pro'))).searchParams.get('fal_webhook')).searchParams.get('k')
    phase.v = 'done'
    const old = new URLSearchParams({ a: 'demo', j: jobId, t: await webhookToken('s3cret', 'demo', jobId) })
    Date.now = () => LEGACY_UNTIL
    const before = t.calls.length
    assert.equal((await t.req(`/webhooks/fal?${old}`, post({}))).status, 401)
    assert.equal(t.calls.length, before) // rien relu chez fal
    assert.equal((await t.req(`/webhooks/fal?k=${k}`, post({}))).status, 200)
  } finally { Date.now = now; t.restore() }
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
