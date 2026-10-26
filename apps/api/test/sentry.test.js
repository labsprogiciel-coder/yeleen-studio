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
