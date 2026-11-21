import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrub, sentryOptions } from '../src/sentry.js'

test('Sentry : inactif sans SENTRY_DSN, sans données personnelles avec', () => {
  assert.equal(sentryOptions({}), undefined)
  const o = sentryOptions({ SENTRY_DSN: 'https://k@o0.ingest.sentry.io/1', ENV: 'production' })
  assert.equal(o.sendDefaultPii, false)
  assert.equal(o.environment, 'production')
})

test('Sentry : ni paramètres d’adresse (jeton du webhook), ni en-têtes, ni corps', () => {
  const e = scrub({ request: { url: 'https://api/webhooks/fal?a=u&j=1&t=secret', query_string: 't=secret', headers: { authorization: 'Bearer x' }, cookies: 'c', data: '{"prompt":"x"}' } })
  assert.deepEqual(e.request, { url: 'https://api/webhooks/fal' })
  assert.deepEqual(scrub({ message: 'm' }), { message: 'm' })
})

test('Sentry : une erreur imprévue dans une route arrive à Sentry (Hono ne la relance pas), et la réponse reste un 500', async () => {
  const { default: worker } = await import('../src/worker.js')
  // La route qui échoue n'existe que dans ce test (l'API n'en garde aucune) : ajoutée à l'application avant sa première requête.
  const { default: app } = await import('../src/index.js')
  app.get('/essai-sentry', () => { throw new Error('Essai Sentry : erreur volontaire du test') })
  const sent = []
  const transport = () => ({ send: async (envelope) => { sent.push(JSON.stringify(envelope)); return {} }, flush: async () => true })
  const env = { ENV: 'dev', SENTRY_DSN: 'https://k@o0.ingest.de.sentry.io/1', SENTRY_TRANSPORT: transport }
  const waits = []
  const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} }
  const quiet = console.error
  console.error = () => {}
  try {
    const res = await worker.fetch(new Request('http://api/essai-sentry'), env, ctx)
    await Promise.all(waits)
    assert.equal(res.status, 500)
    assert.equal(await res.text(), 'Internal Server Error')
  } finally { console.error = quiet }
  assert.ok(sent.some((e) => e.includes('Essai Sentry')), 'l’erreur doit être envoyée à Sentry')
})

test('aucune route d’essai dans l’API : /debug/sentry n’existe plus', async () => {
  const { default: app } = await import('../src/index.js')
  const res = await app.fetch(new Request('http://api/debug/sentry'), { ENV: 'dev' })
  assert.equal(res.status, 404)
})
