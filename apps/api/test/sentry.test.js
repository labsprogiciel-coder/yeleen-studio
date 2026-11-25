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
  const e = scrub({ request: { url: 'https://api/webhooks/fal?k=jeton#x', query_string: 'k=jeton', headers: { authorization: 'Bearer x' }, cookies: 'c', data: '{"prompt":"x"}' } })
  assert.deepEqual(e.request, { url: 'https://api/webhooks/fal' })
  assert.deepEqual(scrub({ message: 'm' }), { message: 'm' })
})

test('Sentry : une erreur imprévue dans une route arrive à Sentry (Hono ne la relance pas), et la réponse reste un 500', async () => {
  const { default: worker } = await import('../src/worker.js')
  // La route qui échoue n'existe que dans ce test (l'API n'en garde aucune) : ajoutée à l'application avant sa première requête.
  const { default: app } = await import('../src/index.js')
  app.get('/essai-sentry', () => { throw new Error('Essai Sentry : erreur volontaire du test') })
  // Miettes réelles du SDK : un journal de la console et un appel sortant avec le numéro dans l'adresse, puis une erreur.
  app.get('/essai-sentry-miettes', async () => {
    console.error('moyens paygate', 'paygate methods 400 +22670123456')
    await fetch('http://127.0.0.1:9/v1/methods?phone=%2B22670123456').catch(() => {})
    throw new Error('Essai Sentry : miettes +22670123456')
  })
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
    const crumbs = await worker.fetch(new Request('http://api/essai-sentry-miettes?q=secret'), env, ctx)
    await Promise.all(waits)
    assert.equal(crumbs.status, 500)
  } finally { console.error = quiet }
  assert.ok(sent.some((e) => e.includes('Essai Sentry : erreur volontaire')), 'l’erreur doit être envoyée à Sentry')
  const miettes = sent.find((e) => e.includes('Essai Sentry : miettes'))
  assert.ok(miettes, 'la seconde erreur doit être envoyée à Sentry')
  assert.ok(!miettes.includes('70123456'), 'aucun numéro : ni dans le message, ni dans les miettes')
  assert.ok(!miettes.includes('moyens paygate'), 'pas de journal de la console')
  assert.ok(!miettes.includes('q=secret'), 'adresse de la requête sans paramètres')
  assert.ok(miettes.includes('[numéro]'))
})

test('aucune route d’essai dans l’API : /debug/sentry n’existe plus', async () => {
  const { default: app } = await import('../src/index.js')
  const res = await app.fetch(new Request('http://api/debug/sentry'), { ENV: 'dev' })
  assert.equal(res.status, 404)
})

test('Sentry, fil d’Ariane : pas de journaux de la console ; un appel sortant sans paramètres ni corps', async () => {
  const { crumb } = await import('../src/sentry.js')
  assert.equal(crumb({ category: 'console', level: 'error', message: 'moyens paygate paygate methods 400: +22670123456' }), null)
  // Forme des miettes de fetch de @sentry/cloudflare (createFetchIntegration de @sentry/core) : paramètres à part, tailles des corps.
  const fetchCrumb = {
    category: 'fetch', type: 'http', level: 'info', timestamp: 1,
    data: { method: 'GET', url: 'https://pay.example/v1/methods?phone=%2B22670123456&operator=orange', 'url.query': 'phone=%2B22670123456', 'http.query': 'phone=x', 'url.fragment': 'f', request_body_size: 42, response_body_size: 10, status_code: 200, body: '{"prompt":"un chat"}' },
  }
  assert.deepEqual(crumb(fetchCrumb), { category: 'fetch', type: 'http', level: 'info', timestamp: 1, data: { method: 'GET', url: 'https://pay.example/v1/methods', status_code: 200 } })
  // Appel en échec (pas de statut), message éventuel retiré ; adresse avec fragment.
  assert.deepEqual(crumb({ category: 'fetch', type: 'http', level: 'error', message: 'x', data: { method: 'POST', url: 'https://queue.fal.run/x#frag' } }), { category: 'fetch', type: 'http', level: 'error', data: { method: 'POST', url: 'https://queue.fal.run/x' } })
  // Autres miettes gardées, sans numéro.
  assert.deepEqual(crumb({ category: 'navigation', message: 'vers +226 70 12 34 56' }), { category: 'navigation', message: 'vers [numéro]' })
  const plain = { category: 'custom', data: { n: 1 } }
  assert.equal(crumb(plain), plain)
  assert.equal(sentryOptions({ SENTRY_DSN: 'https://k@o0.ingest.sentry.io/1' }).beforeBreadcrumb, crumb)
})

test('Sentry, messages d’erreur : un numéro international devient [numéro], identifiants et horodatages intacts', () => {
  const e = scrub({ exception: { values: [{ type: 'PaygateError', value: 'paygate methods 400: {"error":{"detail":"+22670123456 inconnu"}}' }, { type: 'Error', value: 'job_1732540000000 r1 1732540000000' }] }, message: 'appel +226.70.12.34.56' })
  assert.equal(e.exception.values[0].value, 'paygate methods 400: {"error":{"detail":"[numéro] inconnu"}}')
  assert.equal(e.exception.values[1].value, 'job_1732540000000 r1 1732540000000')
  assert.equal(e.message, 'appel [numéro]')
})

test('erreurs des fournisseurs : le message (journaux, Sentry) ne cite pas l’entrée renvoyée ; le corps reste lu par le code', async () => {
  const { FalError } = await import('../src/fal.js')
  const { RunwareError } = await import('../src/runware.js')
  const { HiggsfieldError } = await import('../src/higgsfield.js')
  const { PaygateError } = await import('../src/paygate.js')
  const fal = new FalError(422, { detail: [{ loc: ['body', 'prompt'], msg: 'String too long', type: 'string_too_long', input: 'mon secret de consigne' }] }, 'submit')
  assert.ok(!fal.message.includes('mon secret') && fal.message.includes('string_too_long'))
  assert.equal(fal.body.detail[0].input, 'mon secret de consigne')
  const cp = new FalError(422, { detail: [{ type: 'content_policy_violation', input: { prompt: 'x' } }] }, 'result')
  assert.ok(cp.isContentPolicy)
  assert.ok(!new RunwareError(400, { errors: [{ code: 'invalid', positivePrompt: 'mon secret' }] }, 'submit').message.includes('mon secret'))
  assert.ok(!new HiggsfieldError(400, { detail: { prompt: 'mon secret' } }, 'submit').message.includes('mon secret'))
  const pg = new PaygateError(400, { message: 'bad', phone: '+22670123456' }, 'methods')
  assert.ok(!pg.message.includes('70123456'), pg.message)
  assert.equal(new PaygateError(400, { error: { code: 'invalid_phone' } }, 'collect').message, 'paygate collect 400: invalid_phone')
})

test('erreurs de paygate : le numéro est masqué à la source, sous toutes ses formes, pour les journaux du Worker comme pour Sentry', async () => {
  const { PaygateError } = await import('../src/paygate.js')
  const { errorDetail, noPhone } = await import('../src/redact.js')
  // Corps texte (page d'erreur d'un mandataire qui cite l'adresse appelée), sans error.code.
  const proxy = new PaygateError(502, '<h1>Bad gateway</h1> GET /v1/methods?phone=%2B22670123456&operator=orange', 'methods')
  assert.ok(!proxy.message.includes('70123456'), proxy.message)
  assert.ok(proxy.message.includes('[numéro]'))
  // JSON sans error.code, numéro dans un champ libre ou dans une phrase.
  for (const body of [{ message: 'msisdn 22670123456 inconnu' }, { detail: 'numéro 70 12 34 56 refusé' }, { error: { message: 'bad +225 07 01 02 03 04' } }]) {
    const e = new PaygateError(400, body, 'methods')
    assert.ok(!/70123456|0701020304|70 12 34 56|07 01 02 03 04/.test(e.message), e.message)
  }
  for (const form of ['+22670123456', '%2B22670123456', '0022670123456', '22670123456', '70123456', '771234567', '0701020304', '+226 70 12 34 56']) {
    assert.equal(noPhone(`n=${form};`), 'n=[numéro];', form)
  }
  // Pas de faux positif sur les identifiants, dates, montants et horodatages en millisecondes.
  for (const keep of ['job_1732540000000', '1732540000000', '2026-11-25T10:00:00Z', '550e8400-e29b-41d4-a716-446655440000', '25000 FCFA', 'tu_ABC12345678']) {
    assert.equal(noPhone(keep), keep)
  }
  assert.equal(errorDetail('texte +22670123456'), 'texte [numéro]')
})
