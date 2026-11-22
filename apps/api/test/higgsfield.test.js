import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_MODELS, VIDEO_MODELS, findModel, toJetons, videoCost } from '@studio/catalog'
import { billedSecs, findTool, toolCost, toolInput } from '@studio/catalog/tools'
import { Account } from '../src/account-do.js'
import app from '../src/index.js'
import { HiggsfieldError, higgsfieldClient, resultOf } from '../src/higgsfield.js'
import { buildInput, endpointFor } from '../src/inputs.js'
import { deadlineOf, expireJob } from '../src/jobs.js'
import { priceJob } from '../src/pricing.js'

const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })

test('Higgsfield : envoi authentifié, clé d’idempotence, puis suivi jusqu’au résultat au format fal', async () => {
  const calls = []
  const answers = [
    reply(200, { status: 'queued', request_id: 'r1', status_url: 'https://api.higgsfield.ai/requests/r1/status', cancel_url: 'https://api.higgsfield.ai/requests/r1/cancel' }),
    reply(200, { status: 'queued', request_id: 'r1' }),
    reply(200, { status: 'in_progress', request_id: 'r1' }),
    reply(200, { status: 'completed', request_id: 'r1', video: { url: 'https://cdn.higgsfield.ai/out/a.mp4' } }),
  ]
  const hf = higgsfieldClient({ key: 'id:secret', fetch: async (url, init) => { calls.push({ url, init }); return answers.shift() } })
  const sub = await hf.submit('higgsfield/genjutsu/motion-transfer/v1.0', { video_url: 'v', image_urls: ['i'] }, { idempotencyKey: 'job-1' })
  assert.deepEqual(sub, { requestId: 'r1', statusUrl: 'https://api.higgsfield.ai/requests/r1/status', cancelUrl: 'https://api.higgsfield.ai/requests/r1/cancel' })
  assert.equal(calls[0].url, 'https://api.higgsfield.ai/higgsfield/genjutsu/motion-transfer/v1.0')
  assert.equal(calls[0].init.headers.Authorization, 'Key id:secret')
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'job-1')
  assert.equal((await hf.poll('r1')).status, 'IN_QUEUE')
  assert.equal((await hf.poll('r1')).status, 'IN_PROGRESS')
  const done = await hf.poll('r1')
  assert.equal(calls[3].url, 'https://api.higgsfield.ai/requests/r1/status')
  assert.deepEqual(done, { status: 'COMPLETED', result: { video: { url: 'https://cdn.higgsfield.ai/out/a.mp4', content_type: 'video/mp4' } } })
})

test('Higgsfield : nsfw est un refus de contenu, failed une panne ; une requête refusée lève', async () => {
  const hf = (body, status = 200) => higgsfieldClient({ key: 'k', fetch: async () => reply(status, body) })
  const nsfw = await hf({ status: 'nsfw' }).poll('r')
  assert.equal(nsfw.status, 'FAILED')
  assert.equal(nsfw.error.isContentPolicy, true)
  const failed = await hf({ status: 'failed', error: 'Generation failed' }).poll('r')
  assert.equal(failed.error.isContentPolicy, false)
  await assert.rejects(hf({ detail: 'Invalid credentials' }, 401).poll('r'), HiggsfieldError)
  await assert.rejects(hf({ detail: 'busy' }, 503).poll('r'), HiggsfieldError) // passagère : on réessaiera
  const gone = await hf({ detail: 'Not Found' }, 404).poll('r') // demande inconnue : définitive
  assert.equal(gone.status, 'FAILED')
  assert.equal(gone.error.isContentPolicy, false)
  await assert.rejects(hf({ detail: 'bad' }, 422).submit('x', {}), HiggsfieldError)
  assert.throws(() => higgsfieldClient({ key: '' }), /HIGGSFIELD_KEY/)
})

test('Higgsfield : images sans type déduites de l’extension (enveloppe du webhook comprise)', () => {
  assert.deepEqual(resultOf({ images: [{ url: 'https://c/x.jpg' }, { url: 'https://c/y.webp?sig=1' }] }).images.map((f) => f.content_type), ['image/jpeg', 'image/webp'])
  assert.deepEqual(resultOf({ payload: { video: { url: 'https://c/v', content_type: 'video/mp4' } } }), { video: { url: 'https://c/v', content_type: 'video/mp4' } })
  assert.deepEqual(resultOf({}), {})
})

test('Soul 2 : entrée Higgsfield (format et résolution du catalogue), prix par résolution', () => {
  const soul = findModel(IMAGE_MODELS, 'soul-2')
  assert.equal(soul.provider, 'higgsfield')
  assert.deepEqual(buildInput('image', soul, { prompt: 'un portrait', ratio: '3:4', resolution: '1080p', style: 'photo' }).aspect_ratio, '3:4')
  assert.deepEqual(buildInput('image', soul, { prompt: 'a', ratio: 'Auto', resolution: '4K' }), { prompt: 'a', aspect_ratio: '9:16', resolution: '720p' })
  const p720 = priceJob({ kind: 'image', modelId: 'soul-2', prompt: 'a', resolution: '720p', ratio: '1:1' })
  const p1080 = priceJob({ kind: 'image', modelId: 'soul-2', prompt: 'a', resolution: '1080p', ratio: '1:1' })
  assert.ok(p720.ok && p1080.ok && p1080.cost >= p720.cost)
})

test('Genjutsu : facturé à la seconde mesurée de la source (arrondie au-dessus), la durée maximale faute de mesure', () => {
  const t = findTool('motion-transfer')
  assert.equal(t.provider, 'higgsfield')
  assert.equal(billedSecs(t, 6.2), 7)
  assert.equal(billedSecs(t, 6), 6)
  assert.equal(billedSecs(t, undefined), 20)
  assert.equal(billedSecs(t, 25), 20)
  const inputs = { video: 'https://v3b.fal.media/files/b/x/in.mp4', images: ['https://v3b.fal.media/files/b/x/in.jpg'], resolution: '480p' }
  assert.equal(priceJob({ kind: 'tool', modelId: 'motion-transfer', inputs }, { secs: 6.2 }).cost, toolCost(t, inputs, 7))
  assert.ok(priceJob({ kind: 'tool', modelId: 'motion-transfer', inputs }).cost > priceJob({ kind: 'tool', modelId: 'motion-transfer', inputs }, { secs: 5 }).cost)
  assert.ok(toolCost(t, { ...inputs, resolution: '720p' }) <= 600) // 20 s en 720p : sous le plafond d'une génération (MAX_JOB_COST)
  assert.deepEqual(toolInput(findTool('object-swap'), { ...inputs, prompt: ' la bouteille ' }), { video_url: inputs.video, image_urls: inputs.images, resolution: '480p', prompt: 'la bouteille' })
  assert.equal('prompt' in toolInput(t, inputs), false)
})

test('annulation : confirmée (true) seulement si Higgsfield l’accepte ; déjà commencée (400) ou finie (409) rend false ; autre erreur levée', async () => {
  const cancel = (status) => higgsfieldClient({ key: 'id:secret', fetch: async () => new Response(JSON.stringify({}), { status }) }).cancel('https://api.higgsfield.ai/requests/r1/cancel')
  assert.equal(await cancel(200), true)
  assert.equal(await cancel(400), false)
  assert.equal(await cancel(409), false)
  await assert.rejects(cancel(503))
})

// ── Cinema Studio 4.0 (vidéo) : prix, entrée, puis le parcours entier d'une génération avec un faux Higgsfield ──────────────

const cinema = findModel(VIDEO_MODELS, 'cinema-studio-4')
const IMG = (n) => `https://v3b.fal.media/files/b/abc/ref${n}.png`
const SND = 'https://v3b.fal.media/files/b/abc/voix.mp3'
const clip = { kind: 'video', modelId: 'cinema-studio-4', plans: [{ text: 'Un marché de Dakar au lever du soleil', dur: 5 }], secs: 5, resolution: '720p', ratio: '16:9', sound: true }

test('Cinema Studio 4.0 : servi par Higgsfield, prix à la seconde par résolution avec la marge du catalogue, durée plafonnée à 25 s sous le plafond d’une génération', () => {
  assert.equal(cinema.provider, 'higgsfield')
  assert.equal(endpointFor(cinema, clip), 'higgsfield/cinema-studio/4.0')
  const p = priceJob(clip)
  assert.deepEqual([p.ok, p.model.id, p.count], [true, 'cinema-studio-4', 1])
  assert.equal(p.cost, videoCost(cinema, 5, '720p'))
  assert.equal(p.cost, toJetons(0.607 * 5)) // 109,2 cauris
  assert.equal(priceJob({ ...clip, resolution: '480p' }).cost, toJetons(0.27 * 5))
  assert.equal(priceJob({ ...clip, sound: false }).cost, p.cost) // même prix sans le son
  // La durée la plus longue du catalogue (25 s ; l'API en accepte 30) passe sous MAX_JOB_COST par défaut (600).
  assert.equal(cinema.caps.duration.max, 25)
  const long = priceJob({ ...clip, plans: [{ text: 'a', dur: 25 }], secs: 25 })
  assert.deepEqual([long.ok, long.cost], [true, 545.9])
  assert.ok(long.cost <= 600)
  assert.equal(priceJob({ ...clip, plans: [{ text: 'a', dur: 30 }], secs: 30 }).error, 'invalid_duration')
})

test('Cinema Studio 4.0 : options refusées (durée, résolution, format, plans, vidéo de référence, texte absent, image de départ ou de fin, piste audio)', () => {
  const err = (patch) => priceJob({ ...clip, ...patch }).error
  assert.equal(err({ secs: 3, plans: [{ text: 'a', dur: 3 }] }), 'invalid_duration')
  assert.equal(err({ secs: 26, plans: [{ text: 'a', dur: 26 }] }), 'invalid_duration')
  assert.equal(err({ secs: 5.5, plans: [{ text: 'a', dur: 5.5 }] }), 'invalid_duration')
  assert.equal(err({ resolution: '1080p' }), 'unsupported_resolution')
  assert.equal(err({ ratio: 'auto' }), 'unsupported_ratio')
  assert.equal(err({ ratio: undefined }), 'unsupported_ratio')
  assert.equal(err({ plans: [{ text: 'a', dur: 2 }, { text: 'b', dur: 3 }] }), 'single_plan_only')
  assert.equal(err({ references: [{ kind: 'video', url: 'https://v3b.fal.media/files/b/abc/v.mp4' }] }), 'too_many_references')
  assert.equal(err({ references: [{ kind: 'image', url: 'https://ailleurs.example/x.png' }] }), 'invalid_references')
  assert.equal(err({ task: 'extension', references: [{ kind: 'image', url: IMG(1) }] }), 'task_needs_video')
  // Son API n'a ni image de départ, ni image de fin, ni piste audio : la demande est refusée, pas facturée en les laissant tomber.
  assert.equal(err({ startImageUrl: IMG(9) }), 'start_unsupported')
  assert.equal(err({ endImageUrl: IMG(8) }), 'end_unsupported')
  assert.equal(err({ audioUrl: SND }), 'audio_unsupported')
  assert.equal(err({ startImageUrl: IMG(9), references: [{ kind: 'image', url: IMG(1) }] }), 'start_unsupported')
  // Les autres modèles sans image de départ gardent leur comportement.
  assert.equal(priceJob({ kind: 'video', modelId: 'ltx-2-5-pro-t2v', plans: [{ text: 'a', dur: 6 }], secs: 6, resolution: '1080p', fps: 25, ratio: '16:9', startImageUrl: IMG(9) }).ok, true)
  // Le prompt est obligatoire chez Higgsfield, même avec des références.
  assert.equal(err({ plans: [{ text: ' ', dur: 5 }], references: [{ kind: 'image', url: IMG(1) }] }), 'invalid_text')
  assert.equal(priceJob({ ...clip, references: [{ kind: 'image', url: IMG(1) }, { kind: 'audio', url: SND }] }).cost, priceJob(clip).cost) // images et audio ne changent pas le prix
})

test('Cinema Studio 4.0 : entrée du schéma documenté, rien d’autre ; références citées par <<<image_1>>>', () => {
  assert.deepEqual(buildInput('video', cinema, { ...clip, endUserId: 'user_1', count: 1, fps: 25, camera: 'dolly_in' }), {
    prompt: 'Un marché de Dakar au lever du soleil', duration: 5, resolution: '720p', aspect_ratio: '16:9', generate_audio: true,
  })
  const refs = buildInput('video', cinema, {
    ...clip, sound: false, resolution: '480p', ratio: '9:16', secs: 12,
    plans: [{ text: '@Image2 marche vers @Image1, on entend @Audio1 ; @Image3 et @Video1 restent tels quels', dur: 12 }],
    references: [{ kind: 'image', url: IMG(1) }, { kind: 'audio', url: SND }, { kind: 'image', url: IMG(2) }],
  })
  assert.deepEqual(refs, {
    prompt: '<<<image_2>>> marche vers <<<image_1>>>, on entend <<<audio_1>>> ; @Image3 et @Video1 restent tels quels',
    duration: 12, resolution: '480p', aspect_ratio: '9:16', generate_audio: false, image_urls: [IMG(1), IMG(2)], audio_urls: [SND],
  })
  const allowed = ['prompt', 'duration', 'resolution', 'aspect_ratio', 'generate_audio', 'image_urls', 'audio_urls'] // additionalProperties: false
  assert.ok(Object.keys(refs).every((k) => allowed.includes(k)))
})

test('Genjutsu Light : mêmes champs que Genjutsu, 15 s au plus, facturé à la seconde mesurée, moins cher', () => {
  const light = findTool('motion-transfer-light')
  assert.equal(light.provider, 'higgsfield')
  assert.equal(light.endpoint, 'higgsfield/genjutsu-light/motion-transfer/v1.0')
  assert.equal(findTool('object-swap-light').endpoint, 'higgsfield/genjutsu-light/object-swap/v1.0')
  assert.equal(billedSecs(light, 6.2), 7)
  assert.equal(billedSecs(light, undefined), 15)
  const inputs = { video: 'https://v3b.fal.media/files/b/x/in.mp4', images: ['https://v3b.fal.media/files/b/x/in.jpg'], resolution: '720p' }
  assert.equal(priceJob({ kind: 'tool', modelId: 'motion-transfer-light', inputs }, { secs: 6.2 }).cost, toJetons(0.1471 * 7))
  assert.ok(toolCost(light, inputs, 7) < toolCost(findTool('motion-transfer'), inputs, 7))
  assert.ok(toolCost(light, { ...inputs, resolution: '1080p' }) <= 600) // 15 s en 1080p : sous le plafond d'une génération
  assert.deepEqual(toolInput(findTool('object-swap-light'), { ...inputs, prompt: ' la bouteille ' }), { video_url: inputs.video, image_urls: inputs.images, resolution: '720p', prompt: 'la bouteille' })
  assert.equal(priceJob({ kind: 'tool', modelId: 'motion-transfer-light', inputs: { ...inputs, images: Array(9).fill(inputs.images[0]) } }).error, 'invalid_file_url')
})

/** L'API entière, avec le vrai Account (stockage en mémoire) et un faux Higgsfield : `answer(url, init)` rend { status?, body }. */
function setup(answer, vars = {}) {
  const store = new Map()
  const storage = { get: async (k) => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)) } }
  const account = new Account({ storage }, { ENV: 'dev' })
  const env = {
    FAL_KEY: 'test', HIGGSFIELD_KEY: 'id:secret', ENV: 'dev', ALLOWED_ORIGINS: 'http://localhost:5174', ...vars,
    ACCOUNT: { idFromName: (n) => n, get: () => ({ fetch: (url, init) => account.fetch(new Request(url, init)) }) },
  }
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    if (!u.startsWith('https://api.higgsfield.ai/')) throw new Error(`appel inattendu : ${u}`) // ni fal ni Runware pour ce modèle
    calls.push({ url: u, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined })
    const r = answer(u, init)
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }
  const req = async (path, init) => { const res = await app.fetch(new Request(`http://api${path}`, init), env); return { status: res.status, body: await res.json() } }
  return { req, calls, restore: () => { globalThis.fetch = real } }
}
const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const queuedHf = { status: 'queued', request_id: 'req-1', status_url: 'https://api.higgsfield.ai/requests/req-1/status', cancel_url: 'https://api.higgsfield.ai/requests/req-1/cancel' }
const SUBMIT = 'https://api.higgsfield.ai/higgsfield/cinema-studio/4.0'

test('Cinema Studio 4.0 : débit au prix du catalogue, envoi à Higgsfield, suivi jusqu’à la vidéo', async () => {
  let state = 'queued'
  const t = setup((url) => (url === SUBMIT ? { body: queuedHf }
    : { body: state === 'completed' ? { status: 'completed', request_id: 'req-1', video: { url: 'https://cdn.higgsfield.ai/out/film.mp4' } } : { status: state, request_id: 'req-1' } }))
  try {
    const start = (await t.req('/wallet')).body.balance
    const sent = await t.req('/jobs', post({ ...clip, references: [{ kind: 'image', url: IMG(1) }], plans: [{ text: '@Image1 traverse le marché', dur: 5 }] }))
    assert.equal(sent.status, 202)
    assert.deepEqual([sent.body.status, sent.body.cost], ['IN_QUEUE', toJetons(0.607 * 5)])
    assert.equal(sent.body.balance, Math.round((start - sent.body.cost) * 10) / 10)
    assert.equal(t.calls.length, 1)
    const call = t.calls[0]
    assert.deepEqual([call.url, call.method], [SUBMIT, 'POST'])
    assert.equal(call.headers.Authorization, 'Key id:secret')
    assert.equal(call.headers['Idempotency-Key'], sent.body.jobId) // un envoi répété ne lance pas deux générations
    assert.deepEqual(call.body, { prompt: '<<<image_1>>> traverse le marché', duration: 5, resolution: '720p', aspect_ratio: '16:9', generate_audio: true, image_urls: [IMG(1)] })

    assert.equal((await t.req(`/jobs/${sent.body.jobId}`)).body.status, 'IN_QUEUE')
    state = 'in_progress'
    assert.equal((await t.req(`/jobs/${sent.body.jobId}`)).body.status, 'IN_PROGRESS')
    state = 'completed'
    const done = await t.req(`/jobs/${sent.body.jobId}`)
    assert.equal(done.body.status, 'COMPLETED')
    assert.deepEqual(done.body.outputs, [{ url: 'https://cdn.higgsfield.ai/out/film.mp4', contentType: 'video/mp4' }])
    assert.equal(done.body.balance, sent.body.balance) // rien de remboursé
    assert.equal(t.calls.at(-1).url, 'https://api.higgsfield.ai/requests/req-1/status')
    const n = t.calls.length
    assert.equal((await t.req(`/jobs/${sent.body.jobId}`)).body.status, 'COMPLETED')
    assert.equal(t.calls.length, n) // terminée : Higgsfield n'est plus interrogé
  } finally { t.restore() }
})

test('Cinema Studio 4.0 : échec ou refus pendant la génération, remboursé une seule fois ; une panne du suivi n’échoue rien', async () => {
  let reply = { status: 503, body: { detail: 'busy' } }
  const t = setup((url) => (url === SUBMIT ? { body: queuedHf } : reply))
  try {
    const start = (await t.req('/wallet')).body.balance
    const a = await t.req('/jobs', post(clip))
    assert.equal((await t.req(`/jobs/${a.body.jobId}`)).status, 502) // passagère : la génération reste active, rien n'est remboursé
    assert.equal((await t.req('/wallet')).body.balance, a.body.balance)
    reply = { body: { status: 'failed', request_id: 'req-1', error: 'Generation failed' } }
    const failed = await t.req(`/jobs/${a.body.jobId}`)
    assert.deepEqual([failed.body.status, failed.body.failure, failed.body.refund, failed.body.balance], ['FAILED', 'provider', a.body.cost, start])
    const again = await t.req(`/jobs/${a.body.jobId}`)
    assert.deepEqual([again.body.status, again.body.balance], ['FAILED', start])

    reply = { body: { status: 'nsfw', request_id: 'req-1' } }
    const b = await t.req('/jobs', post(clip))
    const refused = await t.req(`/jobs/${b.body.jobId}`)
    assert.deepEqual([refused.body.status, refused.body.failure, refused.body.balance], ['FAILED', 'moderation', start])
  } finally { t.restore() }
})

test('Cinema Studio 4.0 : envoi refusé par Higgsfield, remboursé tout de suite ; sans clé ou trop cher, ni débit ni appel', async () => {
  const t = setup(() => ({ status: 400, body: { detail: "resolution: '1080p' is not one of ['480p', '720p']" } }))
  try {
    const start = (await t.req('/wallet')).body.balance
    const res = await t.req('/jobs', post(clip))
    assert.deepEqual([res.status, res.body.error, res.body.balance], [502, 'provider', start])
    assert.equal(t.calls.length, 1)
  } finally { t.restore() }
  const none = setup(() => { throw new Error('aucun appel attendu') }, { HIGGSFIELD_KEY: '' })
  try {
    const start = (await none.req('/wallet')).body.balance
    const res = await none.req('/jobs', post(clip))
    assert.deepEqual([res.status, res.body.error], [503, 'provider_unavailable'])
    assert.equal((await none.req('/wallet')).body.balance, start)
  } finally { none.restore() }
  const capped = setup(() => { throw new Error('aucun appel attendu') }, { MAX_JOB_COST: '100' })
  try {
    const res = await capped.req('/jobs', post({ ...clip, plans: [{ text: 'a', dur: 10 }], secs: 10 }))
    assert.deepEqual([res.status, res.body.error], [400, 'too_expensive'])
    assert.equal(capped.calls.length, 0)
  } finally { capped.restore() }
})

test('Cinema Studio 4.0 : annulation en file confirmée par Higgsfield, remboursée ; déjà commencée, non remboursée', async () => {
  let state = 'queued'
  let cancelStatus = 200
  const t = setup((url) => (url === SUBMIT ? { body: queuedHf }
    : url.endsWith('/cancel') ? (cancelStatus === 200 ? { body: { status: 'canceled' } } : { status: cancelStatus, body: { detail: 'already started' } })
      : { body: { status: state, request_id: 'req-1' } }))
  try {
    const start = (await t.req('/wallet')).body.balance
    const a = await t.req('/jobs', post(clip))
    const out = await t.req(`/jobs/${a.body.jobId}/cancel`, { method: 'POST' })
    assert.deepEqual([out.body.status, out.body.refund, out.body.balance], ['CANCELED', a.body.cost, start])
    const cancel = t.calls.find((c) => c.url.endsWith('/cancel'))
    assert.deepEqual([cancel.url, cancel.method, cancel.headers.Authorization], ['https://api.higgsfield.ai/requests/req-1/cancel', 'POST', 'Key id:secret'])

    state = 'in_progress'
    cancelStatus = 400
    const b = await t.req('/jobs', post(clip))
    const late = await t.req(`/jobs/${b.body.jobId}/cancel`, { method: 'POST' })
    assert.deepEqual([late.body.status, late.body.refund, late.body.balance], ['CANCELED', 0, b.body.balance]) // Higgsfield la facture
  } finally { t.restore() }
})

test('Cinema Studio 4.0 : jamais terminée, le réveil du compte la fait échouer au délai (2 h), l’annule chez Higgsfield et la rembourse', async () => {
  const t = setup((url) => (url.endsWith('/cancel') ? { body: { status: 'canceled' } } : { body: { status: 'in_progress', request_id: 'req-1' } }))
  try {
    const job = { id: 'j1', kind: 'video', provider: 'higgsfield', status: 'IN_PROGRESS', requestId: 'req-1', cancelUrl: queuedHf.cancel_url, createdAt: Date.now() - 2 * 3600_000 - 1000 }
    assert.ok(deadlineOf(job) < Date.now())
    assert.ok(deadlineOf({ ...job, createdAt: Date.now() - 3600_000 }) > Date.now()) // une heure : encore dans les temps
    const asked = []
    const r = await expireJob({ env: { HIGGSFIELD_KEY: 'id:secret' }, acct: async (path, body) => { asked.push([path, body]); return { refunded: 83.8 } }, job })
    assert.deepEqual(asked, [['/job/fail', { jobId: 'j1', failure: 'timeout' }]])
    assert.equal(r.refunded, 83.8)
    assert.deepEqual(t.calls.map((c) => [c.url, c.method]), [[queuedHf.cancel_url, 'POST']])
  } finally { t.restore() }
})

// ── Images Higgsfield : Soul Cinema, Soul Standard (prix, entrée, puis le parcours entier) ───────────

const image = (modelId, patch = {}) => ({ kind: 'image', modelId, prompt: 'une vendeuse de tissus au marché', ...patch })
const SOUL_RATIOS = ['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2']

test('images Higgsfield : prix par option, au tarif de l’estimation avec la marge du catalogue', () => {
  const cost = (id, resolution, more = {}) => priceJob(image(id, { resolution, ...more })).cost
  // Soul Cinema : 0,004 $ en 720p, 0,006 $ en 1080p ; le format ne change pas le prix.
  assert.deepEqual([cost('soul-cinema', '720p'), cost('soul-cinema', '1080p')], [toJetons(0.004), toJetons(0.006)])
  assert.deepEqual([cost('soul-cinema', '720p'), cost('soul-cinema', '1080p')], [0.1, 0.2]) // comme Soul 2 : arrondi au dixième de cauri
  for (const ratio of SOUL_RATIOS) assert.equal(cost('soul-cinema', '1080p', { ratio }), 0.2)
  // Soul Standard : 0,094 $ en 720p, 0,188 $ en 1080p.
  assert.deepEqual([cost('soul-standard', '720p'), cost('soul-standard', '1080p')], [toJetons(0.094), toJetons(0.188)])
  assert.deepEqual([cost('soul-standard', '720p'), cost('soul-standard', '1080p')], [3.4, 6.8])
  // Sans résolution : la première du catalogue ; une image par demande, quel que soit le nombre demandé.
  for (const id of ['soul-cinema', 'soul-standard']) {
    const m = findModel(IMAGE_MODELS, id)
    const p = priceJob(image(id, { count: 4 }))
    assert.deepEqual([p.ok, p.model.provider, p.count, p.cost], [true, 'higgsfield', 1, cost(id, m.caps.resolutions[0])], id)
  }
})

test('images Higgsfield : options refusées (résolution, format, texte absent)', () => {
  const err = (id, patch) => priceJob(image(id, patch)).error
  for (const id of ['soul-cinema', 'soul-standard']) {
    assert.equal(err(id, { resolution: '2K' }), 'unsupported_resolution')
    assert.equal(err(id, { ratio: '21:9' }), 'unsupported_ratio')
    assert.equal(err(id, { ratio: 'Auto' }), 'unsupported_ratio')
    assert.equal(err(id, { prompt: ' ' }), 'invalid_text')
    assert.equal(priceJob(image(id, { prompt: 'a'.repeat(6000) })).ok, true) // pas de limite documentée, prix fixe
  }
})

test('images Higgsfield : entrée du schéma documenté, rien d’autre', () => {
  const noise = { count: 4, endUserId: 'user_1', seed: 7, references: [{ kind: 'image', url: IMG(1) }] }
  for (const id of ['soul-cinema', 'soul-standard']) {
    const m = findModel(IMAGE_MODELS, id)
    assert.equal(endpointFor(m, {}), { 'soul-cinema': 'higgsfield-ai/soul/cinema', 'soul-standard': 'higgsfield-ai/soul/standard' }[id])
    assert.deepEqual(buildInput('image', m, image(id, { ratio: '3:4', resolution: '1080p', brandStyle: 'tons chauds', ...noise })), { prompt: 'une vendeuse de tissus au marché, tons chauds', aspect_ratio: '3:4', resolution: '1080p' })
    assert.deepEqual(buildInput('image', m, image(id, {})), { prompt: 'une vendeuse de tissus au marché', aspect_ratio: '9:16', resolution: '720p' })
  }
})

for (const [id, body, usd] of [
  ['soul-cinema', { prompt: 'une vendeuse de tissus au marché', aspect_ratio: '3:4', resolution: '1080p' }, 0.006],
  ['soul-standard', { prompt: 'une vendeuse de tissus au marché', aspect_ratio: '3:4', resolution: '1080p' }, 0.188],
]) {
  const m = findModel(IMAGE_MODELS, id)
  const url = `https://api.higgsfield.ai/${m.endpoint}`
  const ask = image(id, { ratio: '3:4', resolution: m.caps.resolutions[1], count: 1 })

  test(`${m.name} : débit au prix du catalogue, envoi à Higgsfield, suivi jusqu’à l’image`, async () => {
    let state = 'queued'
    const t = setup((u) => (u === url ? { body: queuedHf }
      : { body: state === 'completed' ? { status: 'completed', request_id: 'req-1', images: [{ url: 'https://cdn.higgsfield.ai/out/image.png' }] } : { status: state, request_id: 'req-1' } }))
    try {
      const start = (await t.req('/wallet')).body.balance
      const sent = await t.req('/jobs', post(ask))
      assert.equal(sent.status, 202)
      assert.deepEqual([sent.body.status, sent.body.cost], ['IN_QUEUE', toJetons(usd)])
      assert.equal(sent.body.balance, Math.round((start - sent.body.cost) * 10) / 10)
      assert.equal(t.calls.length, 1)
      assert.deepEqual([t.calls[0].url, t.calls[0].method, t.calls[0].headers.Authorization, t.calls[0].headers['Idempotency-Key']], [url, 'POST', 'Key id:secret', sent.body.jobId])
      assert.deepEqual(t.calls[0].body, body)
      state = 'in_progress'
      assert.equal((await t.req(`/jobs/${sent.body.jobId}`)).body.status, 'IN_PROGRESS')
      state = 'completed'
      const done = await t.req(`/jobs/${sent.body.jobId}`)
      assert.equal(done.body.status, 'COMPLETED')
      assert.deepEqual(done.body.outputs, [{ url: 'https://cdn.higgsfield.ai/out/image.png', contentType: 'image/png' }])
      assert.equal(done.body.balance, sent.body.balance) // rien de remboursé
    } finally { t.restore() }
  })

  test(`${m.name} : échec, refus de contenu ou envoi refusé, remboursé ; sans clé, ni débit ni appel`, async () => {
    let reply = { body: { status: 'failed', request_id: 'req-1', error: 'Generation failed' } }
    let submit = { body: queuedHf }
    const t = setup((u) => (u === url ? submit : reply))
    try {
      const start = (await t.req('/wallet')).body.balance
      const a = await t.req('/jobs', post(ask))
      const failed = await t.req(`/jobs/${a.body.jobId}`)
      assert.deepEqual([failed.body.status, failed.body.failure, failed.body.refund, failed.body.balance], ['FAILED', 'provider', a.body.cost, start])
      assert.equal((await t.req(`/jobs/${a.body.jobId}`)).body.balance, start) // remboursé une seule fois
      reply = { body: { status: 'nsfw', request_id: 'req-1' } }
      const b = await t.req('/jobs', post(ask))
      const refused = await t.req(`/jobs/${b.body.jobId}`)
      assert.deepEqual([refused.body.status, refused.body.failure, refused.body.balance], ['FAILED', 'moderation', start])
      submit = { status: 403, body: { detail: 'Model not available for this account' } } // accès de la clé non confirmé (Soul Cinema)
      const c = await t.req('/jobs', post(ask))
      assert.deepEqual([c.status, c.body.error, c.body.balance], [502, 'provider', start])
    } finally { t.restore() }
    const none = setup(() => { throw new Error('aucun appel attendu') }, { HIGGSFIELD_KEY: '' })
    try {
      const start = (await none.req('/wallet')).body.balance
      const res = await none.req('/jobs', post(ask))
      assert.deepEqual([res.status, res.body.error], [503, 'provider_unavailable'])
      assert.equal((await none.req('/wallet')).body.balance, start)
    } finally { none.restore() }
  })
}
