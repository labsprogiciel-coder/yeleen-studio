import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_MODELS, findModel } from '@studio/catalog'
import { billedSecs, findTool, toolCost, toolInput } from '@studio/catalog/tools'
import { HiggsfieldError, higgsfieldClient, resultOf } from '../src/higgsfield.js'
import { buildInput } from '../src/inputs.js'
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
