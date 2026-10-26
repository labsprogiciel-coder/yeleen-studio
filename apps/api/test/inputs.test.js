import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUDIO_MODELS, IMAGE_MODELS } from '@studio/catalog'
import { buildInput, outputsOf } from '../src/inputs.js'
import { isBlocked } from '../src/moderation.js'

const nano = IMAGE_MODELS.find((m) => m.id === 'nano-banana-pro')
const flux = IMAGE_MODELS.find((m) => m.id === 'flux-3')

test('Nano Banana : prompt composé du style, nombre d’images, format et résolution', () => {
  const i = buildInput('image', nano, { prompt: 'un hippo', styleHint: 'anime', brandStyle: 'tons chauds', count: 2, resolution: '2K', ratio: 'Auto' })
  assert.deepEqual(i, { prompt: 'un hippo, anime, tons chauds', num_images: 2, aspect_ratio: 'auto', resolution: '2K', output_format: 'png' })
})

test('Flux 3 : résolution en minuscules et pas de num_images', () => {
  const i = buildInput('image', flux, { prompt: 'a', resolution: '2K', ratio: '16:9' })
  assert.equal(i.resolution, '2k')
  assert.equal('num_images' in i, false)
})

test('voix : seuls les paramètres que le modèle expose sont envoyés', () => {
  const v3 = AUDIO_MODELS.find((m) => m.id === 'eleven-v3')
  const i = buildInput('audio', v3, { prompt: ' Bonjour ', voice: 'Sarah', stability: 0.3, language: 'fr', normalization: 'on', timestamps: true })
  assert.deepEqual(i, { text: 'Bonjour', voice: 'Sarah', stability: 0.3, language_code: 'fr', apply_text_normalization: 'on', timestamps: true })
  assert.equal('language_code' in buildInput('audio', v3, { prompt: 'a', language: 'auto' }), false)
})

test('les sorties ont le même format quel que soit le média', () => {
  const img = outputsOf('image', { images: [{ url: 'u1', content_type: 'image/png', width: 10, height: 20 }] })
  assert.deepEqual(img, [{ url: 'u1', contentType: 'image/png', width: 10, height: 20 }])
  assert.equal(outputsOf('audio', { audio: { url: 'a', content_type: 'audio/mpeg' } })[0].url, 'a')
  assert.deepEqual(outputsOf('image', {}), [])
})

test('la modération refuse les mots interdits', () => {
  assert.equal(isBlocked('une scène de violence'), true)
  assert.equal(isBlocked('un chat'), false)
})

test('workflow : les textes sont nettoyés et les villes réparties sur prompt … prompt_7', async () => {
  const { findWorkflow } = await import('@studio/catalog/workflows')
  const replace = buildInput('workflow', findWorkflow('replace-anything'), { inputs: { image_url: 'https://v3.fal.media/a.png', text_prompt: ' le sac ', prompt: 'un sac rouge' } })
  assert.deepEqual(replace, { image_url: 'https://v3.fal.media/a.png', text_prompt: 'le sac', prompt: 'un sac rouge' })
  const city = buildInput('workflow', findWorkflow('city-journey'), { inputs: { image_urls: ['https://v3.fal.media/p.png'], cities: 'Dakar\n\n Paris \nTokyo' } })
  assert.deepEqual(city, { image_urls: ['https://v3.fal.media/p.png'], prompt: 'Dakar', prompt_2: 'Paris', prompt_3: 'Tokyo', prompt_4: 'Dakar', prompt_5: 'Paris', prompt_6: 'Tokyo', prompt_7: 'Dakar' })
})

test('outils : chaque entrée envoyée à fal suit le schéma du point d’accès', async () => {
  const { findTool } = await import('@studio/catalog/tools')
  const f = 'https://v3.fal.media/files/a.png'
  assert.deepEqual(buildInput('tool', findTool('change-camera'), { inputs: { image: f, angle: 'profile' } }), { image_urls: [f], horizontal_angle: 90, vertical_angle: 0, zoom: 5, num_images: 1, output_format: 'png' })
  assert.deepEqual(buildInput('tool', findTool('music-generator'), { inputs: { prompt: ' afrobeat ', length: '60', vocals: 'vocals' } }), { prompt: 'afrobeat', music_length_ms: 60000, force_instrumental: false })
  assert.deepEqual(buildInput('tool', findTool('variations'), { inputs: { image: f, count: '4' } }).num_images, 4)
  assert.deepEqual(buildInput('tool', findTool('speak-text'), { inputs: { image: f, text: 'Bonjour', resolution: '480p' } }), { image_url: f, text: 'Bonjour', resolution: '480p' })
})

test('outils ajoutés : prolonger, fluidifier, recadrer, restaurer, photo produit', async () => {
  const { findTool } = await import('@studio/catalog/tools')
  const v = 'https://v3.fal.media/files/c.mp4'
  const f = 'https://v3.fal.media/files/a.png'
  assert.deepEqual(buildInput('tool', findTool('video-extend'), { inputs: { video: v, mode: 'start', duration: '10' } }), { video_url: v, mode: 'start', duration: 10 })
  assert.deepEqual(buildInput('tool', findTool('video-fps'), { inputs: { video: v, fps: '120' } }), { video_url: v, target_fps: 120, model: 'Apollo', H264_output: true })
  assert.deepEqual(buildInput('tool', findTool('video-reframe'), { inputs: { video: v } }), { video_url: v, aspect_ratio: '9:16', resolution: '720p' })
  assert.deepEqual(buildInput('tool', findTool('photo-restore'), { inputs: { image: f, colors: 'keep' } }), { image_url: f, remove_scratches: true, enhance_resolution: true, fix_colors: false })
  const product = buildInput('tool', findTool('product-photo'), { inputs: { image: f, scene: 'market', ratio: '4:5' } }) // Krea 3 par défaut
  assert.deepEqual(product.image_size, { width: 1296, height: 1616 }) // 4:5, environ 2,1 Mpx, multiples de 16
  assert.match(product.prompt, /market stall/)
})

test('Krea 3 (générateur d’images) : taille exacte au format choisi, au plus la surface facturée', async () => {
  const { IMAGE_MODELS, imageCost } = await import('@studio/catalog')
  const krea = IMAGE_MODELS.find((m) => m.id === 'krea-3')
  const input = buildInput('image', krea, { prompt: 'un marché à Bobo-Dioulasso', ratio: '16:9', resolution: '2K' })
  assert.equal(input.prompt, 'un marché à Bobo-Dioulasso')
  assert.ok(input.image_size.width / input.image_size.height > 1.7 && input.image_size.width * input.image_size.height <= 2.1e6)
  assert.equal(buildInput('image', krea, { prompt: 'x', ratio: 'Auto', resolution: '1K' }).image_size.width, buildInput('image', krea, { prompt: 'x', ratio: '1:1', resolution: '1K' }).image_size.width)
  assert.ok(imageCost(krea, '2K', 1) > imageCost(krea, '1K', 1))
})
