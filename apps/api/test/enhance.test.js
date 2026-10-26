import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account-do.js'
import app from '../src/index.js'
import { cleanOutput, enhanceInput, ENHANCE_MODEL, parseShots, shotModel } from '../src/enhance.js'

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
  let fail = 2
  const t = setup(() => (fail === 2 ? { status: 500, body: { detail: 'boom' } }
    : fail === 1 ? { body: { output: 'Un plan.', error: 'upstream' } } : { body: { output: 'Un plan large.' } }), { MAX_ENHANCE_PER_DAY: '1' })
  try {
    assert.equal((await t.req({ text: 'un plan', kind: 'image' })).status, 502)
    fail = 1 // réponse 200 mais `error` rempli : un échec aussi
    assert.equal((await t.req({ text: 'un plan', kind: 'image' })).status, 502)
    fail = 0
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
  assert.equal(cleanOutput('@Image10 marche.', '@Image1 marche'), '@Image10 marche. @Image1') // jeton entier, pas un préfixe
  const long = cleanOutput('x'.repeat(3000), 'un plan @Image1 @Video2')
  assert.equal(long.length, 2000)
  assert.ok(long.endsWith(' @Image1 @Video2'))
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

test('plans : l’idée est découpée en plans pour un modèle multi-plans', async () => {
  const shots = [{ text: '@Awa ouvre son étal au lever du jour.', dur: 5 }, { text: 'Gros plan sur les beignets qui dorent.', dur: 3 }]
  const t = setup(() => ({ body: { output: `Voici :\n\`\`\`json\n${JSON.stringify(shots)}\n\`\`\`` } }))
  try {
    const res = await t.req({ text: '@Awa vend des beignets au marché', kind: 'shots', modelId: 'kling-3-pro' })
    assert.equal(res.status, 200)
    assert.deepEqual((await res.json()).plans, shots)
    assert.match(t.calls[0].body.prompt, /Kling 3\.0 Pro.*15 s au plus en tout/s)
  } finally { t.restore() }
})

test('plans : refusé sans appel pour un modèle à plan unique ; réponse illisible remboursée', async () => {
  const t = setup(() => ({ body: { output: 'pas de JSON ici' } }), { MAX_ENHANCE_PER_DAY: '1' })
  try {
    assert.equal((await t.req({ text: 'une idée', kind: 'shots', modelId: 'veo-3-1-lite' })).status, 400)
    assert.equal(t.calls.length, 0)
    assert.equal((await t.req({ text: 'une idée', kind: 'shots', modelId: 'kling-3-pro' })).status, 502)
    assert.equal((await t.req({ text: 'une idée', kind: 'shots', modelId: 'kling-3-pro' })).status, 502) // le quota a été rendu
  } finally { t.restore() }
})

test('plans : durées ramenées aux choix et à la durée maximale, références gardées', () => {
  const m = shotModel('kling-3-pro')
  const out = JSON.stringify([{ text: 'Plan un.', dur: 9 }, { text: 'Plan deux.', dur: 7 }, { text: 'Plan trois.', dur: 'x' }, { text: '', dur: 3 }, { text: 'Plan quatre.', dur: 2 }, { text: 'Plan cinq.', dur: 2 }])
  const ps = parseShots(out, 'idée avec @Image1', m)
  assert.equal(ps.length, 4)
  assert.ok(ps.reduce((n, p) => n + p.dur, 0) <= 15)
  assert.ok(ps.every((p) => [2, 3, 5, 8, 10].includes(p.dur)))
  assert.ok(ps[0].text.endsWith('@Image1'))
  assert.equal(parseShots('[{"text": "Un seul plan.", "dur": 5}]', 'x', m), null)
  assert.equal(shotModel('veo-3-1-lite'), null)
})

test('retouche d’image : l’instruction dit ce qui change et ce qui reste, pour le modèle d’édition choisi', async () => {
  const t = setup(() => ({ body: { output: 'Remplace le fond par un étal de marché coloré ; garde le flacon, son étiquette et ses couleurs identiques.' } }))
  try {
    const res = await t.req({ text: 'fond marché', kind: 'edit', modelId: 'krea-3' })
    assert.equal(res.status, 200)
    assert.match(t.calls[0].body.prompt, /Retouche d'une image existante, modèle Krea 3/)
    assert.match(t.calls[0].body.system_prompt, /ce qui doit rester identique/)
  } finally { t.restore() }
  // Un modèle inconnu n'est pas pris pour le premier de la liste
  assert.equal(enhanceInput({ text: 'un chat', kind: 'image', modelId: 'inconnu' }).prompt.split('\n')[0], 'Image fixe.')
})
