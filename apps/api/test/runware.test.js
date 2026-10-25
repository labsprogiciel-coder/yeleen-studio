import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runwareClient, retryDelay, RunwareError } from '../src/runware.js'

/** Réponses successives de l'API Runware ; `headers` : en-têtes HTTP de chaque réponse. */
function fakeApi(replies) {
  const calls = []
  const fetch = async (_url, init) => {
    const { status, body, headers = {} } = replies[Math.min(calls.length, replies.length - 1)]
    calls.push(JSON.parse(init.body))
    return { ok: status < 400, status, headers: new Headers(headers), text: async () => JSON.stringify(body) }
  }
  return { fetch, calls }
}
const overloaded = (retryAfter) => ({ status: 429, body: { errors: [{ code: 'serviceOverloaded', retryAfter }] } })
const accepted = { status: 200, body: { data: [{ taskType: 'videoInference', status: 'processing' }] } }
const TASK = { model: 'klingai:kling-video@3-pro', positivePrompt: 'Un plan', duration: 5 }

test('un refus pour capacité est réessayé avec l’attente demandée, et la même tâche', async () => {
  const api = fakeApi([overloaded(7), overloaded(2), accepted])
  const waits = []
  const rw = runwareClient({ key: 'k', fetch: api.fetch, sleep: async (ms) => { waits.push(ms) } })
  const { taskUUID } = await rw.submit(TASK)
  assert.equal(api.calls.length, 3)
  assert.deepEqual(waits, [7000, 2000])
  assert.ok(api.calls.every((c) => c[0].taskUUID === taskUUID)) // pas de nouvelle tâche à chaque essai
})

test('après 3 nouveaux essais refusés, l’erreur remonte (le débit sera remboursé)', async () => {
  const api = fakeApi([overloaded(1)])
  const rw = runwareClient({ key: 'k', fetch: api.fetch, sleep: async () => {} })
  await assert.rejects(rw.submit(TASK), RunwareError)
  assert.equal(api.calls.length, 4)
})

test('une erreur qui n’est pas de capacité n’est pas réessayée', async () => {
  const api = fakeApi([{ status: 400, body: { errors: [{ code: 'invalidParameter', message: 'duration' }] } }])
  const rw = runwareClient({ key: 'k', fetch: api.fetch, sleep: async () => { throw new Error('pas d’attente attendue') } })
  await assert.rejects(rw.submit(TASK), RunwareError)
  assert.equal(api.calls.length, 1)
})

test('attente : Retry-After, sinon 1, 2, 4 s, plafonnée à 8 s', () => {
  const r = (over = {}) => ({ errors: [], ...over })
  assert.equal(retryDelay(r({ retryAfter: '5' }), 0), 5000)
  assert.equal(retryDelay(r({ errors: [{ retryAfter: 30 }] }), 0), 8000)
  assert.deepEqual([0, 1, 2].map((a) => retryDelay(r(), a)), [1000, 2000, 4000])
})

test('un 503 sans corps est aussi réessayé', async () => {
  const api = fakeApi([{ status: 503, body: 'Service Unavailable' }, accepted])
  const rw = runwareClient({ key: 'k', fetch: api.fetch, sleep: async () => {} })
  await rw.submit(TASK)
  assert.equal(api.calls.length, 2)
})
