import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUDIO_MODELS, IMAGE_MODELS, imageCost, voiceCost } from '@studio/catalog'
import { priceJob } from '../src/pricing.js'

test('le prix serveur vient du catalogue', () => {
  const m = IMAGE_MODELS[0]
  const r = priceJob({ kind: 'image', modelId: m.id, prompt: 'un chat', resolution: '2K', count: 2 })
  assert.equal(r.cost, imageCost(m, '2K', 2))
})

test('modèle, type, résolution, format et voix inconnus sont refusés', () => {
  const m = IMAGE_MODELS[0]
  assert.equal(priceJob({ kind: 'gif', modelId: 'x' }).error, 'unknown_kind')
  assert.equal(priceJob({ kind: 'image', modelId: 'nope', prompt: 'a' }).error, 'unknown_model')
  assert.equal(priceJob({ kind: 'image', modelId: m.id, prompt: 'a', resolution: '16K' }).error, 'unsupported_resolution')
  assert.equal(priceJob({ kind: 'image', modelId: m.id, prompt: 'a', ratio: '7:3' }).error, 'unsupported_ratio')
  assert.equal(priceJob({ kind: 'image', modelId: m.id, prompt: '   ' }).error, 'invalid_text')
  assert.equal(priceJob({ kind: 'audio', modelId: AUDIO_MODELS[0].id, prompt: 'Bonjour', voice: 'Inconnue' }).error, 'unknown_voice')
})

test('le nombre d’images est borné par le modèle', () => {
  const m = IMAGE_MODELS[0]
  const r = priceJob({ kind: 'image', modelId: m.id, prompt: 'a', resolution: '1K', count: 99 })
  assert.equal(r.cost, imageCost(m, '1K', m.caps.maxImages))
  const flux = IMAGE_MODELS.find((x) => x.id === 'flux-3')
  assert.equal(priceJob({ kind: 'image', modelId: flux.id, prompt: 'a', resolution: '1K', count: 4 }).count, 1)
})

test('le prix d’une voix suit le nombre de caractères', () => {
  const m = AUDIO_MODELS[0]
  assert.equal(priceJob({ kind: 'audio', modelId: m.id, prompt: 'x'.repeat(1500) }).cost, voiceCost(m, 1500))
})

test('essayage : deux photos déposées chez fal, prix du catalogue', async () => {
  const { TRYON_MODEL, tryonCost } = await import('@studio/catalog')
  const { buildInput, outputsOf } = await import('../src/inputs.js')
  const ok = { kind: 'tryon', modelId: TRYON_MODEL.id, modelImageUrl: 'https://v3.fal.media/files/a.png', garmentImageUrl: 'https://v3.fal.media/files/b.png' }
  assert.equal(priceJob(ok).cost, tryonCost())
  assert.equal(priceJob({ ...ok, garmentImageUrl: 'https://evil.example/b.png' }).error, 'invalid_file_url')
  assert.equal(priceJob({ ...ok, modelImageUrl: undefined }).error, 'invalid_file_url')
  assert.equal(priceJob({ ...ok, modelId: 'x' }).error, 'unknown_model')
  assert.deepEqual(buildInput('tryon', TRYON_MODEL, ok), { model_image: ok.modelImageUrl, garment_image: ok.garmentImageUrl, num_samples: 1, output_format: 'png' })
  assert.equal(outputsOf('tryon', { images: [{ url: 'https://v3.fal.media/x.png', content_type: 'image/png' }] })[0].url, 'https://v3.fal.media/x.png')
})

test('workflow fal : liste fermée, entrées contrôlées, prix du catalogue, sortie lue sans connaître sa forme', async () => {
  const { WORKFLOWS, workflowCost } = await import('@studio/catalog/workflows')
  const { buildInput, outputsOf } = await import('../src/inputs.js')
  const f = 'https://v3.fal.media/files/a.png'
  const weather = WORKFLOWS.find((w) => w.id === 'weather')
  const ok = { kind: 'workflow', modelId: 'weather', inputs: { image_urls: [f], weather: 'pluie' } }
  assert.equal(priceJob(ok).cost, workflowCost(weather))
  assert.equal(priceJob({ ...ok, modelId: 'labsprogiciel-coder/logomaker' }).error, 'unknown_model')
  assert.equal(priceJob({ ...ok, inputs: { image_urls: ['https://evil.example/a.png'], weather: 'pluie' } }).error, 'invalid_file_url')
  assert.equal(priceJob({ ...ok, inputs: { image_urls: [f], weather: '' } }).error, 'invalid_text')
  assert.deepEqual(buildInput('workflow', priceJob(ok).model, ok), { image_urls: [f], weather: 'pluie' })
  const out = outputsOf('workflow', { video: { url: 'https://v3.fal.media/v.mp4', content_type: 'video/mp4' }, extra: { images: [{ url: 'https://v3.fal.media/i.png', content_type: 'image/png' }] }, note: 'texte' })
  assert.deepEqual(out.map((o) => o.url), ['https://v3.fal.media/v.mp4', 'https://v3.fal.media/i.png'])
})

test('outil du studio : liste fermée, fichiers déposés chez fal, choix connus, prix du catalogue', async () => {
  const { findTool, toolCost } = await import('@studio/catalog/tools')
  const { buildInput, outputsOf } = await import('../src/inputs.js')
  const f = 'https://v3.fal.media/files/a.png'
  const ok = { kind: 'tool', modelId: 'relight', inputs: { image: f, light: 'neon' } }
  assert.equal(priceJob(ok).cost, toolCost(findTool('relight'), ok.inputs))
  assert.equal(priceJob({ ...ok, modelId: 'nope' }).error, 'unknown_model')
  assert.equal(priceJob({ ...ok, inputs: { image: 'https://ailleurs.com/a.png' } }).error, 'invalid_file_url')
  assert.equal(priceJob({ ...ok, inputs: { image: f, light: 'laser' } }).error, 'invalid_option')
  assert.deepEqual(buildInput('tool', priceJob(ok).model, ok), { image_url: f, lighting_style: 'neon' })
  // Choix par défaut : le premier de la liste.
  assert.deepEqual(buildInput('tool', findTool('relight'), { inputs: { image: f } }), { image_url: f, lighting_style: 'natural' })
  // Sortie lue sans connaître sa forme, type déduit du nom de fichier s'il manque.
  assert.deepEqual(outputsOf('tool', { audio: { url: 'https://v3.fal.media/s.mp3', file_name: 's.mp3' } }).map((o) => o.contentType), ['audio/mpeg'])
})

test('outil du studio : texte requis, plage de nombres et règle entre champs', () => {
  const v = 'https://v3.fal.media/files/c.mp4'
  assert.equal(priceJob({ kind: 'tool', modelId: 'music-generator', inputs: { prompt: '  ' } }).error, 'invalid_text')
  assert.equal(priceJob({ kind: 'tool', modelId: 'clip-editor', inputs: { video: v, start: 4, end: 2 } }).error, 'invalid_option')
  assert.equal(priceJob({ kind: 'tool', modelId: 'clip-editor', inputs: { video: v, start: -1, end: 2 } }).error, 'invalid_option')
  assert.equal(priceJob({ kind: 'tool', modelId: 'clip-editor', inputs: { video: v, start: 1, end: 3 } }).ok, true)
  assert.equal(priceJob({ kind: 'tool', modelId: 'video-project-editor', inputs: { videos: [v] } }).error, 'invalid_file_url') // deux clips au moins
})

test('outil du studio : le prix suit la durée et la taille choisies, au pire cas pour un fichier fourni', async () => {
  const { findTool, toolCost } = await import('@studio/catalog/tools')
  const { toJetons } = await import('@studio/catalog')
  const music = findTool('music-generator')
  assert.equal(toolCost(music, { prompt: 'a', length: '30' }), toJetons(0.6)) // minute entamée
  assert.equal(toolCost(music, { prompt: 'a', length: '120' }), toJetons(1.2))
  assert.equal(toolCost(findTool('video-upscaler'), { target: '4k' }), toJetons(0.0288 * 30))
  assert.equal(toolCost(findTool('speak-text'), { text: 'x'.repeat(95), resolution: '720p' }), toJetons(10 * 0.15)) // 10 s de parole
  for (const t of (await import('@studio/catalog/tools')).TOOLS) assert.ok(toolCost(t, {}) <= 250, `${t.id} dépasse le plafond d'une génération`)
})

test('outils ajoutés : prix au pire cas affiché (durée ajoutée, images créées, durée maximale)', async () => {
  const { findTool, toolCost } = await import('@studio/catalog/tools')
  const { EXTEND_MODEL, toJetons } = await import('@studio/catalog')
  assert.equal(toolCost(findTool('video-extend'), { duration: '20' }), toJetons(EXTEND_MODEL.price.usd * 20))
  assert.equal(toolCost(findTool('video-fps'), { fps: '60' }), toJetons((60 - 24) * 10 * 0.002))
  assert.equal(toolCost(findTool('video-reframe'), { resolution: '1080p' }), toJetons(2))
  assert.equal(findTool('video-hdr').maxHeight, 1080)
})
