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
  // Higgsfield (image comme vidéo) : pas de point d'accès fal, donc absent des chaînes ; les images fal y restent.
  for (const e of ENTRIES) assert.equal(e.model.provider === 'higgsfield', false, e.id)
  for (const id of ['soul-2', 'soul-cinema', 'soul-standard']) assert.equal(ENTRIES.some((e) => e.id === `img:${id}`), false, id)
  assert.deepEqual(ENTRIES.filter((e) => e.kind === 'image').map((e) => e.model.id), IMAGE_MODELS.filter((m) => !m.provider).map((m) => m.id))
  assert.ok(ENTRIES.some((e) => e.kind === 'image'))
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

test('LTX 2.5 : endpoints lightricks, prix fal, à côté des modèles 2.3 inchangés', async () => {
  const { durationOptions } = await import('../src/models.js')
  const ep = (id) => findModel(VIDEO_MODELS, id)?.endpoint
  assert.equal(ep('ltx-2-5-pro'), 'lightricks/ltx-2.5/image-to-video/pro')
  assert.equal(ep('ltx-2-5-fast'), 'lightricks/ltx-2.5/image-to-video/fast')
  assert.equal(ep('ltx-2-5-pro-t2v'), 'lightricks/ltx-2.5/text-to-video/pro')
  assert.equal(ep('ltx-2-5-fast-t2v'), 'lightricks/ltx-2.5/text-to-video/fast')
  assert.equal(ep('ltx-2-5-a2v'), 'lightricks/ltx-2.5/audio-to-video/pro')
  assert.equal(ep('ltx-2-5-fast-a2v'), 'lightricks/ltx-2.5/audio-to-video/fast')
  for (const id of ['ltx-2-3-pro', 'ltx-2-3-pro-t2v', 'ltx-2-3-fast-t2v', 'ltx-2-3-a2v']) assert.match(ep(id), /^fal-ai\/ltx-2\.3\//)
  const pro = findModel(VIDEO_MODELS, 'ltx-2-5-pro')
  assert.equal(videoCost(pro, 10, '1080p'), toJetons(1.7))
  assert.equal(videoCost(pro, 6, '720p'), toJetons(0.72))
  assert.equal(videoCost(findModel(VIDEO_MODELS, 'ltx-2-5-fast-t2v'), 10, '2160p'), toJetons(3))
  assert.equal(videoCost(findModel(VIDEO_MODELS, 'ltx-2-5-a2v'), 10), toJetons(1.7))
  assert.equal(videoCost(findModel(VIDEO_MODELS, 'ltx-2-5-fast-a2v'), 20), toJetons(2.6))
  // Fast : 20 s en 1080p à 25 i/s, 10 s en 1440p ou à 50 i/s
  const t2v = findModel(VIDEO_MODELS, 'ltx-2-5-fast-t2v').caps
  assert.equal(Math.max(...durationOptions(t2v, '1080p', 25)), 20)
  assert.equal(Math.max(...durationOptions(t2v, '1440p', 25)), 10)
  assert.equal(Math.max(...durationOptions(t2v, '1080p', 50)), 10)
})

test('audio vers vidéo : secondes facturées = durée mesurée arrondie à la seconde au-dessus, dans les limites du modèle', async () => {
  const { audioBilledSecs } = await import('../src/models.js')
  const range = { min: 2, max: 10 }
  assert.deepEqual([5, 5.04, 7.3, 0, 1.9, 10.04, 30].map((s) => audioBilledSecs(range, s)), [5, 5, 8, 2, 2, 10, 10])
})

test('Cinema Studio 4.0 (Higgsfield) : dans la liste vidéo, options du schéma documenté, prix par résolution, absent des chaînes fal', async () => {
  const { ENTRIES } = await import('../src/chainDefs.js')
  const { slotRules } = await import('../src/templateSlots.js')
  const { durationOptions, priceLabel, lowestRate } = await import('../src/models.js')
  const m = VIDEO_MODELS.find((x) => x.id === 'cinema-studio-4')
  assert.deepEqual([m.provider, m.endpoint, m.verified, m.input], ['higgsfield', 'higgsfield/cinema-studio/4.0', false, 'text'])
  assert.deepEqual(m.caps.resolutions, ['480p', '720p'])
  assert.deepEqual(m.caps.ratios, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'])
  assert.deepEqual(durationOptions(m.caps, '720p'), [4, 5, 6, 8, 10, 12, 15, 20, 25]) // l'API accepte 30 s : plafonné à 25 s
  assert.equal(m.caps.strictFiles, true)
  assert.match(m.tagline, /25 s/)
  assert.ok(m.tags.includes('Jusqu’à 25 s') && !m.tags.some((t) => /30 s/.test(t)))
  assert.deepEqual([m.caps.audio, m.caps.startFrame, m.caps.endFrame, m.caps.multiShot, m.caps.tasks], ['toggle', 'none', false, false, undefined])
  // Références : images et audio seulement (une vidéo de référence changerait le tarif), pas d'image de départ ni de fin.
  assert.deepEqual(slotRules(m), { start: null, end: false, elements: 0, references: { image: 30, video: 0, audio: 10 }, audio: null, multiShot: false })
  assert.equal(videoCost(m, 5, '720p'), toJetons(0.607 * 5))
  assert.equal(videoCost(m, 5, '480p', { sound: false }), toJetons(0.27 * 5))
  assert.equal(videoCost(m, m.caps.duration.max, '720p'), 545.9) // la plus longue vidéo proposée passe sous le plafond d'une génération
  assert.ok(videoCost(m, m.caps.duration.max, '720p') <= 600) // MAX_JOB_COST par défaut ; 30 s (655 cauris) ne passeraient pas
  assert.deepEqual(lowestRate(m), { usd: 0.27, from: true })
  assert.match(priceLabel(m), /^dès ≈ 9,7 cauris \/ s$/)
  // Une chaîne s'exécute chez fal : un modèle vidéo servi par Higgsfield n'y figure pas.
  assert.equal(ENTRIES.some((e) => e.id === 'vid:cinema-studio-4'), false)
  for (const e of ENTRIES.filter((x) => x.kind === 'video')) assert.notEqual(e.model.provider, 'higgsfield', e.id)
})

test('Genjutsu Light : deux outils Higgsfield, 4 à 15 s, trois résolutions, facturés à la seconde de la source', async () => {
  const { findTool, toolCost, toolEndpoint } = await import('../src/tools.js')
  for (const [id, path] of [['motion-transfer-light', 'higgsfield/genjutsu-light/motion-transfer/v1.0'], ['object-swap-light', 'higgsfield/genjutsu-light/object-swap/v1.0']]) {
    const t = findTool(id)
    assert.deepEqual([t.provider, toolEndpoint(t, {}), t.output, t.minSecs, t.maxSecs, t.bySecs], ['higgsfield', path, 'video', 4, 15, 'video'])
    assert.deepEqual(t.inputs.find((f) => f.key === 'resolution').options.map((o) => o.id), ['480p', '720p', '1080p'])
    assert.equal(toolCost(t, { resolution: '480p' }, 5), toJetons(0.0739 * 5))
    assert.equal(toolCost(t, { resolution: '1080p' }), toJetons(0.2936 * 15)) // sans mesure : la durée maximale
  }
  // Changement de version : un choix que l'autre version n'offre pas est oublié (sinon le serveur refuserait la demande).
  const { toolCarry, toolInputIssue } = await import('../src/tools.js')
  const full = findTool('motion-transfer')
  const typed = { prompt: 'garder le décor', resolution: '1080p' }
  assert.equal(toolInputIssue(full, { video: 'v', images: ['i'], ...typed }), 'invalid_resolution')
  assert.deepEqual(toolCarry(full, typed), { prompt: 'garder le décor' })
  assert.deepEqual(toolCarry(findTool('motion-transfer-light'), typed), typed)
  assert.deepEqual(toolCarry(full, { prompt: 'a', resolution: '720p' }), { prompt: 'a', resolution: '720p' })
})

test('images Higgsfield : Soul Cinema et Soul Standard, sur le modèle de Soul 2', async () => {
  const { priceLabel, lowestRate } = await import('../src/models.js')
  const soul = ['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2']
  const want = {
    'soul-2': ['higgsfield-ai/soul/v2/standard', soul, { '720p': 0.004, '1080p': 0.006 }],
    'soul-cinema': ['higgsfield-ai/soul/cinema', soul, { '720p': 0.004, '1080p': 0.006 }],
    'soul-standard': ['higgsfield-ai/soul/standard', soul, { '720p': 0.094, '1080p': 0.188 }],
  }
  assert.deepEqual(IMAGE_MODELS.filter((m) => m.provider === 'higgsfield').map((m) => m.id), Object.keys(want))
  for (const [id, [endpoint, ratios, usd]] of Object.entries(want)) {
    const m = IMAGE_MODELS.find((x) => x.id === id)
    assert.deepEqual([m.provider, m.endpoint, m.verified, m.caps.maxImages, m.price.per], ['higgsfield', endpoint, false, 1, 'image'], id)
    assert.deepEqual(m.caps.ratios, ratios, id)
    assert.deepEqual(m.caps.resolutions, Object.keys(usd), id)
    assert.deepEqual(Object.keys(m.caps.resUnits), Object.keys(usd), id)
    for (const [res, price] of Object.entries(usd)) assert.equal(imageCost(m, res, 1), toJetons(price), `${id} ${res}`)
    assert.ok(m.tagline && m.tags.length >= 2, id)
    assert.deepEqual(lowestRate(m), { usd: Object.values(usd)[0], from: false }, id)
  }
  // Soul 2 et Soul Cinema : 0,1 et 0,2 cauri (arrondi au dixième de cauri, comme sur main).
  for (const id of ['soul-2', 'soul-cinema']) assert.deepEqual(['720p', '1080p'].map((r) => imageCost(IMAGE_MODELS.find((x) => x.id === id), r, 1)), [0.1, 0.2], id)
  assert.deepEqual(['720p', '1080p'].map((r) => imageCost(IMAGE_MODELS.find((x) => x.id === 'soul-standard'), r, 1)), [3.4, 6.8])
  assert.match(priceLabel(IMAGE_MODELS.find((m) => m.id === 'soul-standard')), /^≈ 3,4 cauris \/ image$/)
})
