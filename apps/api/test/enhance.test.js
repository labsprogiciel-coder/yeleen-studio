import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account-do.js'
import app from '../src/index.js'
import { cleanOutput, enhanceInput, ENHANCE_MODEL } from '../src/enhance.js'

/** L'API avec le vrai Account (stockage en mémoire) et un faux fal ; `calls` : les appels faits à fal. */
function setup(fal, vars = {}) {
  const store = new Map()
  const storage = { get: async (k) => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)) } }
  const account = new Account({ storage }, { ENV: 'dev' })
  const env = {
    FAL_KEY: 'test', ENV: 'dev', ALLOWED_ORIGINS: 'http://localhost:5174', ...vars,
    ACCOUNT: { idFromName: (n) => n, get: () => ({ fetch: (url, init) => account.fetch(new Request(url, init)) }) },
  }
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    const r = fal(String(url))
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }
  const req = (body) => app.fetch(new Request('http://api/enhance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env)
  return { req, calls, restore: () => { globalThis.fetch = real } }
}

test('améliorer : appel direct au modèle de texte, texte nettoyé, quota décompté', async () => {
  const t = setup(() => ({ body: { output: '« Une femme vend des beignets dorés au marché de Ouagadougou, lumière du matin, travelling lent. »' } }))
  try {
    const res = await t.req({ text: 'une femme vend des beignets', kind: 'video', modelId: 'kling-3-pro' })
    const out = await res.json()
    assert.equal(res.status, 200)
    assert.equal(out.text, 'Une femme vend des beignets dorés au marché de Ouagadougou, lumière du matin, travelling lent.')
    assert.equal(out.remaining, 29)
    assert.equal(t.calls[0].url, 'https://fal.run/openrouter/router')
    assert.equal(t.calls[0].body.model, ENHANCE_MODEL)
    assert.match(t.calls[0].body.prompt, /Kling 3\.0 Pro/)
  } finally { t.restore() }
})

test('améliorer : au-delà du quota du jour, refusé sans appeler fal', async () => {
  const t = setup(() => ({ body: { output: 'Un plan large.' } }), { MAX_ENHANCE_PER_DAY: '2' })
  try {
    assert.equal((await t.req({ text: 'un plan', kind: 'image' })).status, 200)
    assert.equal((await t.req({ text: 'un plan', kind: 'image' })).status, 200)
    const res = await t.req({ text: 'un plan', kind: 'image' })
    assert.equal(res.status, 429)
    assert.deepEqual(await res.json(), { ok: false, error: 'daily_limit', max: 2 })
    assert.equal(t.calls.length, 2)
  } finally { t.restore() }
})

test('améliorer : un échec de fal ne compte pas dans le quota', async () => {
  let fail = true
  const t = setup(() => (fail ? { status: 500, body: { detail: 'boom' } } : { body: { output: 'Un plan large.' } }), { MAX_ENHANCE_PER_DAY: '1' })
  try {
    assert.equal((await t.req({ text: 'un plan', kind: 'image' })).status, 502)
    fail = false
    assert.equal((await t.req({ text: 'un plan', kind: 'image' })).status, 200)
  } finally { t.restore() }
})

test('améliorer : texte trop court ou refusé par la modération, sans appel', async () => {
  const t = setup(() => ({ body: { output: 'x' } }))
  try {
    assert.equal((await t.req({ text: 'ab' })).status, 400)
    assert.equal((await t.req({ text: 'une scène de violence' })).status, 422)
    assert.equal(t.calls.length, 0)
  } finally { t.restore() }
})

test('nettoyage : préfixe et guillemets retirés, références @ gardées', () => {
  assert.equal(cleanOutput('Instruction réécrite : "Un plan large."', 'un plan'), 'Un plan large.')
  assert.equal(cleanOutput('@Image1 marche dans la rue.', '@Image1 marche @Image2'), '@Image1 marche dans la rue. @Image2')
  assert.equal(cleanOutput('   ', 'un plan'), null)
})

test('entrée : le modèle visé et ses limites sont décrits', () => {
  const v = enhanceInput({ text: 'un plan', kind: 'video', modelId: 'veo-3-1-lite' })
  assert.match(v.prompt, /Veo 3\.1 Lite, 8 s au plus par plan/)
  assert.match(enhanceInput({ text: 'un chat', kind: 'image', modelId: 'flux-3' }).prompt, /Image fixe, modèle Flux 3/)
  assert.ok(v.system_prompt.includes('@'))
})

test('voix off : script écrit à partir d’une idée, dans la langue choisie', async () => {
  const t = setup(() => ({ body: { output: 'Script : Envie de beignets chauds ? Chez Awa, au marché central, ils sortent de l’huile chaque matin. Passez nous voir !' } }))
  try {
    const res = await t.req({ text: 'beignets chez Awa, marché central, tous les matins', kind: 'voice', language: 'fr' })
    const out = await res.json()
    assert.equal(res.status, 200)
    assert.equal(out.text, 'Envie de beignets chauds ? Chez Awa, au marché central, ils sortent de l’huile chaque matin. Passez nous voir !')
    assert.match(t.calls[0].body.system_prompt, /voix off/)
    assert.match(t.calls[0].body.prompt, /20 à 30 secondes, en français/)
  } finally { t.restore() }
})

test('voix off : sans langue choisie (détection auto), aucune langue imposée', () => {
  const i = enhanceInput({ text: 'promo', kind: 'voice', language: 'auto' })
  assert.doesNotMatch(i.prompt, /, en /)
  assert.match(i.system_prompt, /n'invente ni prix/)
})

test('modèles : le texte d’un champ est précisé selon son rôle et la longueur de son exemple', async () => {
  const t = setup(() => ({ body: { output: 'pluie battante, éclairs au loin, ciel gris ardoise' } }))
  try {
    const res = await t.req({ text: 'orage', kind: 'template', workflowId: 'weather', field: 'weather' })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).text, 'pluie battante, éclairs au loin, ciel gris ardoise')
    assert.match(t.calls[0].body.prompt, /Modèle « Météo à la carte »/)
    assert.match(t.calls[0].body.prompt, /Champ « Météo »/)
    assert.match(t.calls[0].body.prompt, /expression courte/)
  } finally { t.restore() }
})

test('modèles : un champ à garder tel quel ou inconnu est refusé sans appel ni quota', async () => {
  const t = setup(() => ({ body: { output: 'x' } }), { MAX_ENHANCE_PER_DAY: '1' })
  try {
    assert.deepEqual(await (await t.req({ text: 'le sac sur la table', kind: 'template', workflowId: 'replace-anything', field: 'text_prompt' })).json(), { error: 'not_enhanceable' })
    assert.equal((await t.req({ text: 'Dakar', kind: 'template', workflowId: 'city-journey', field: 'cities' })).status, 400)
    assert.equal((await t.req({ text: 'un logo', kind: 'template', workflowId: 'inconnu', field: 'prompt' })).status, 400)
    assert.equal(t.calls.length, 0)
    assert.equal((await t.req({ text: 'un logo de maquis', kind: 'template', workflowId: 'logo_maker', field: 'prompt' })).status, 200) // le quota est intact
  } finally { t.restore() }
})
