import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api } from '../src/lib/api.js'

/** Faux fetch : note chaque appel (adresse, méthode, corps) et répond avec `reply(appel)` ({ status, body }). */
function fakeFetch(reply) {
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: new URL(String(url).replace(/^undefined/, ''), 'http://api') /* sans VITE_API_URL hors Vite */, method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.parse(init.body) }
    calls.push(call)
    const { status = 200, body = {} } = reply(call)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return { calls, restore: () => { globalThis.fetch = real } }
}

const q = { country: 'BF', operator: 'orange', phone: '+22670123456', pack: 'studio' }

test('topupOptions et adminUsers : POST, données dans le corps, rien dans l’adresse', async () => {
  const f = fakeFetch(() => ({ body: { ok: true } }))
  try {
    assert.deepEqual(await api.topupOptions(q), { ok: true })
    assert.deepEqual(await api.adminUsers('alice@example.test'), { ok: true })
    assert.equal(f.calls.length, 2)
    const [opt, search] = f.calls
    assert.deepEqual([opt.method, opt.url.pathname, opt.url.search, opt.body], ['POST', '/topups/options', '', q])
    assert.deepEqual([search.method, search.url.pathname, search.url.search, search.body], ['POST', '/admin/users/search', '', { q: 'alice@example.test' }])
    for (const c of f.calls) assert.ok(!/70123456|alice/.test(c.url.href), c.url.href)
  } finally { f.restore() }
})

test('API d’avant ce changement (404 ou 405 sur le POST) : une seule nouvelle demande, par l’ancienne forme GET', async () => {
  for (const status of [404, 405]) {
    const f = fakeFetch((c) => (c.method === 'POST' ? { status, body: {} } : { body: { legacy: true } }))
    try {
      assert.deepEqual(await api.topupOptions(q), { legacy: true })
      assert.deepEqual(await api.adminUsers('bob'), { legacy: true })
      assert.deepEqual(f.calls.map((c) => [c.method, c.url.pathname]), [['POST', '/topups/options'], ['GET', '/topups/options'], ['POST', '/admin/users/search'], ['GET', '/admin/users']])
      assert.deepEqual(Object.fromEntries(f.calls[1].url.searchParams), q)
      assert.equal(f.calls[3].url.searchParams.get('q'), 'bob')
    } finally { f.restore() }
  }
})

test('autre erreur de la nouvelle route (refus, blocage, panne) : rendue telle quelle, sans repli par l’adresse', async () => {
  for (const [status, error] of [[400, 'invalid_phone'], [403, 'account_blocked'], [502, 'provider'], [410, 'gone']]) {
    const f = fakeFetch(() => ({ status, body: { error } }))
    try {
      await assert.rejects(api.topupOptions(q), (e) => e.status === status && e.message === error)
      await assert.rejects(api.adminUsers('x'), (e) => e.status === status)
      assert.ok(f.calls.every((c) => c.method === 'POST'))
    } finally { f.restore() }
  }
})
