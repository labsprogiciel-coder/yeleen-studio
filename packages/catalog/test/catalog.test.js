import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS, imageCost, videoCost, voiceCost, toJetons, findModel } from '../src/models.js'

test('toJetons applique la marge ×2 et un plancher de 0,1', () => {
  assert.equal(toJetons(0), 0.1)
  assert.ok(toJetons(0.14) > toJetons(0.07))
})

test('chaque modèle a un identifiant unique et un prix', () => {
  for (const list of [IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS]) {
    assert.equal(new Set(list.map((m) => m.id)).size, list.length)
    for (const m of list) assert.ok(m.price && (m.provider === 'runware' ? /^[a-z]+:[\w.-]+@[\w.-]+$/.test(m.air) : m.endpoint), m.id)
  }
})

test('Runware : le son et une vidéo en entrée changent le prix ; sans précision, le tarif le plus haut', () => {
  const kling = findModel(VIDEO_MODELS, 'kling-3-pro')
  assert.equal(videoCost(kling, 5, undefined), toJetons(0.168 * 5))
  assert.equal(videoCost(kling, 5, undefined, { sound: false }), toJetons(0.112 * 5))
  const veo = findModel(VIDEO_MODELS, 'veo-3-1-lite')
  assert.equal(videoCost(veo, 8, '720p', { sound: false }), toJetons(0.03 * 8))
  assert.equal(videoCost(veo, 8, '1080p'), toJetons(0.08 * 8))
  const seed = findModel(VIDEO_MODELS, 'seedance-2-5')
  assert.equal(videoCost(seed, 5, '480p'), toJetons(0.102 * 5))
  assert.equal(videoCost(seed, 5, '480p', { sound: false }), videoCost(seed, 5, '480p')) // Seedance : même prix avec ou sans son
  assert.equal(videoCost(seed, 5, '720p', { inputSecs: 30.2 }), toJetons(0.295 * 5)) // tarif « vidéo en entrée », durée produite seule
})

test('chaînes : les modèles Runware y gardent leur point d’accès et leur prix fal, ou n’y figurent pas', async () => {
  const { ENTRIES } = await import('../src/chainDefs.js')
  const vid = (id) => ENTRIES.find((e) => e.id === `vid:${id}`)?.model
  assert.equal(vid('kling-3-pro').endpoint, 'fal-ai/kling-video/v3/pro/image-to-video')
  assert.equal(vid('seedance-2-5').price.byRes['720p'], 0.473)
  assert.equal(vid('veo-3-1-lite'), undefined)
  assert.equal(vid('kling-3-std'), undefined)
  for (const e of ENTRIES) assert.ok(e.model.endpoint, e.id)
})

test('les coûts sont positifs et croissent avec la quantité', () => {
  const img = IMAGE_MODELS[0]
  assert.ok(imageCost(img, img.caps.resolutions[0], 2) > imageCost(img, img.caps.resolutions[0], 1))
  const vid = findModel(VIDEO_MODELS, 'ltx-2-5-fast')
  assert.ok(videoCost(vid, 10, '720p') > videoCost(vid, 5, '720p'))
  assert.ok(voiceCost(AUDIO_MODELS[0], 2500) > voiceCost(AUDIO_MODELS[0], 900))
})

test('les voix ont des identifiants uniques et findVoice retombe sur la première', async () => {
  const { VOICES, findVoice } = await import('../src/voices.js')
  assert.equal(new Set(VOICES.map((v) => v.id)).size, VOICES.length)
  assert.equal(findVoice('inconnue').id, VOICES[0].id)
})

test('modèles : un par workflow, au prix du catalogue, avec ce qui manque pour lancer', async () => {
  const { RECIPES, recipeCost, recipeIssue } = await import('../src/recipes.js')
  const { WORKFLOWS, workflowCost } = await import('../src/workflows.js')
  assert.equal(RECIPES.length, WORKFLOWS.length)
  for (const r of RECIPES) assert.equal(recipeCost(r.id), workflowCost(r.workflow))
  assert.match(recipeIssue('wf-weather', { photos: {} }), /Ajoutez/)
  assert.match(recipeIssue('wf-weather', { texts: { weather: '' }, photos: { image_urls: 1 } }), /météo/i)
  assert.equal(recipeIssue('wf-weather', { texts: { weather: 'pluie' }, photos: { image_urls: 1 } }), null)
  assert.equal(recipeIssue('wf-photo-to-video', { photos: { person1: 1, person2: 1 } }), null)
  assert.equal(recipeIssue('wf-kling-multi-shot-creator', { texts: { prompt: 'idée' } }), null)
  // deux textes (Changer un objet) et une liste de villes (Voyage de ville en ville)
  assert.match(recipeIssue('wf-replace-anything', { texts: { text_prompt: 'le sac' }, photos: { image_url: 1 } }), /par quoi/i)
  assert.equal(recipeIssue('wf-replace-anything', { texts: { text_prompt: 'le sac', prompt: 'un sac rouge' }, photos: { image_url: 1 } }), null)
  assert.match(recipeIssue('wf-city-journey', { texts: { cities: 'Dakar\nParis' }, photos: { image_urls: 1 } }), /3 villes/)
  assert.match(recipeIssue('wf-city-journey', { texts: { cities: 'a\nb\nc\nd\ne\nf\ng\nh' }, photos: { image_urls: 1 } }), /7 villes/)
  assert.equal(recipeIssue('wf-city-journey', { texts: { cities: 'Dakar\nParis\nTokyo' }, photos: { image_urls: 1 } }), null)
})

test('workflows : une liste de villes est répartie sur les sept entrées de fal', async () => {
  const { findWorkflow, workflowInputIssue } = await import('../src/workflows.js')
  const w = findWorkflow('city-journey')
  const expand = w.inputs.find((f) => f.key === 'cities').expand
  assert.deepEqual(expand(['Dakar', 'Paris', 'Tokyo']), { prompt: 'Dakar', prompt_2: 'Paris', prompt_3: 'Tokyo', prompt_4: 'Dakar', prompt_5: 'Paris', prompt_6: 'Tokyo', prompt_7: 'Dakar' })
  assert.equal(Object.keys(expand(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).length, 7)
  assert.equal(workflowInputIssue(w, { image_urls: ['x'], cities: 'Dakar\nParis' }), 'invalid_cities')
  assert.equal(workflowInputIssue(w, { image_urls: ['x'], cities: ' ' }), 'missing_cities')
  assert.equal(workflowInputIssue(w, { image_urls: ['x'], cities: 'Dakar\n\nParis\nTokyo' }), null) // lignes vides ignorées
})

test('workflows fal : champs, prix et contrôle des entrées', async () => {
  const { WORKFLOWS, workflowCost, workflowInputIssue } = await import('../src/workflows.js')
  assert.equal(new Set(WORKFLOWS.map((w) => w.id)).size, WORKFLOWS.length)
  for (const w of WORKFLOWS) {
    assert.match(w.endpoint, /^workflows\/[\w-]+\/[\w-]+$/)
    assert.ok(workflowCost(w) > 0)
  }
  const weather = WORKFLOWS.find((w) => w.id === 'weather')
  assert.equal(workflowInputIssue(weather, { image_urls: ['a'], weather: 'pluie' }), null)
  assert.equal(workflowInputIssue(weather, { image_urls: ['a'], weather: ' ' }), 'missing_weather')
  assert.equal(workflowInputIssue(weather, { image_urls: [], weather: 'pluie' }), 'missing_image_urls')
  assert.equal(workflowInputIssue(weather, { image_urls: ['a', 'b'], weather: 'pluie' }), 'missing_image_urls')
  const p2v = WORKFLOWS.find((w) => w.id === 'photo-to-video')
  assert.equal(workflowInputIssue(p2v, { person1: 'a' }), 'missing_person2')
  assert.equal(workflowInputIssue(WORKFLOWS.find((w) => w.id === 'fan-cam'), { image_urls: ['a'] }), null) // détails facultatifs
})

test('outils : identifiants uniques, un point d’accès, des choix et un prix pour chacun', async () => {
  const { TOOLS, toolCost, toolEndpoint, toolInputIssue } = await import('../src/tools.js')
  assert.equal(new Set(TOOLS.map((t) => t.id)).size, TOOLS.length)
  for (const t of TOOLS) {
    assert.match(toolEndpoint(t, {}), /^[\w-]+\/[\w./-]+$/, t.id)
    for (const f of t.inputs.filter((x) => x.type === 'model')) for (const o of f.options) assert.match(toolEndpoint(t, { [f.key]: o.id }), /^[\w-]+\/[\w./-]+$/, `${t.id} ${o.id}`)
    assert.ok(['image', 'video', 'audio'].includes(t.output), t.id)
    for (const f of t.inputs.filter((x) => x.type === 'select')) assert.ok(f.options.length > 0, `${t.id}.${f.key}`)
    assert.ok(toolCost(t, {}) >= 0.1, t.id)
    assert.ok(toolInputIssue(t, {}) !== null || t.inputs.every((f) => f.type === 'select' || (f.type === 'text' && !f.required)), `${t.id} : entrées vides acceptées`)
  }
})

test('outils image au modèle choisi : point d’accès, entrée et prix du modèle choisi', async () => {
  const { findTool, toolCost, toolEndpoint, toolInput, toolInputIssue } = await import('../src/tools.js')
  const { EDIT_MODELS, dims } = await import('../src/editModels.js')
  const photo = findTool('product-photo')
  const img = 'https://v3b.fal.media/files/p.png'
  // Krea 3 par défaut : taille exacte au format choisi, prix à la surface (sortie + référence)
  assert.equal(toolEndpoint(photo, {}), 'krea/v3/edit')
  const krea = toolInput(photo, { image: img, ratio: '4:5' })
  assert.deepEqual(krea.image_urls, [img])
  assert.deepEqual(krea.image_size, dims('4:5', 2.1))
  assert.ok(krea.image_size.width % 16 === 0 && krea.image_size.width * krea.image_size.height <= 2.1e6)
  assert.ok(toolCost(photo, { image: img, ratio: '4:5' }) > toolCost(photo, { ratio: '4:5' })) // la référence compte
  // Nano Banana Pro au choix : son point d'accès et son schéma
  const nb = { image: img, model: 'nano-banana-pro', ratio: '1:1' }
  assert.equal(toolEndpoint(photo, nb), 'fal-ai/nano-banana-pro/edit')
  assert.deepEqual({ ...toolInput(photo, nb), prompt: '' }, { prompt: '', image_urls: [img], aspect_ratio: '1:1', resolution: '2K', num_images: 1, output_format: 'png' })
  assert.equal(toolInputIssue(photo, { image: img, model: 'inconnu' }), 'invalid_model')
  // Variations : seulement des modèles à plusieurs images par appel
  const vari = findTool('variations').inputs.find((f) => f.key === 'model').options.map((o) => o.id)
  assert.ok(!vari.includes('krea-3') && vari.length > 1)
  // Un modèle sans 4K est ramené à sa plus grande taille, et chaque modèle donne un prix positif
  const ed = findTool('editor')
  assert.equal(toolInput(ed, { images: [img], prompt: 'x', model: 'seedream-5-pro', resolution: '4K' }).image_size, 'auto_2K')
  for (const m of EDIT_MODELS) assert.ok(toolCost(ed, { images: [img], prompt: 'x', model: m.id }) >= 0.1, m.id)
  // Qwen Image 3 : 3 images de référence au plus ; les autres modèles en gardent 4 dans l'éditeur
  const { toolCheck } = await import('../src/tools.js')
  const four = { images: [img, img, img, img], prompt: 'x' }
  assert.equal(toolCheck(ed, { ...four, model: 'qwen-image-3' }), 'too_many_images')
  assert.equal(toolCheck(ed, { ...four, images: four.images.slice(0, 3), model: 'qwen-image-3' }), null)
  assert.equal(toolCheck(ed, four), null)
})
