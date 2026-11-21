import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { Account } from '../src/account-do.js'
import app from '../src/index.js'
import { resetUserCache } from '../src/users.js'
import { testD1 } from './d1.js'

beforeEach(() => resetUserCache())

/** L'API entière avec le vrai Account, une vraie base D1 (SQLite), un faux bucket R2 et un faux fal. */
function setup({ files = true, vars = {} } = {}) {
  const db = testD1()
  const store = new Map()
  const storage = { get: async (k) => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)) } }
  const account = new Account({ storage }, { ENV: 'dev', DB: db })
  const objects = new Map()
  const bucket = {
    put: async (key, body, opts) => {
      const buf = body instanceof ArrayBuffer ? body : body?.getReader ? await new Response(body).arrayBuffer() : body
      objects.set(key, { buf, type: opts?.httpMetadata?.contentType })
      return { size: buf?.byteLength ?? 0 }
    },
    get: async (key) => { const o = objects.get(key); return o && { body: new Uint8Array(o.buf), size: o.buf.byteLength, httpMetadata: { contentType: o.type } } },
    head: async (key) => { const o = objects.get(key); return o ? { size: o.buf.byteLength } : null },
    delete: async (key) => { objects.delete(key) },
  }
  const env = {
    ENV: 'dev', FAL_KEY: 'test', DB: db, ALLOWED_ORIGINS: 'http://localhost:5174', ...(files ? { FILES: bucket } : {}), ...vars,
    ACCOUNT: { idFromName: (n) => n, get: () => ({ fetch: (url, init) => account.fetch(new Request(url, init)) }) },
  }
  let phase = 'queue'
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.endsWith('/nano-banana-pro')) return Response.json({ request_id: 'r1', status_url: 'https://q/x/status', response_url: 'https://q/x', cancel_url: 'https://q/x/cancel' })
    if (u.includes('/status')) return Response.json({ status: phase === 'queue' ? 'IN_PROGRESS' : 'COMPLETED' })
    if (u === 'https://q/x') return Response.json({ images: [{ url: 'https://cdn/a.png', content_type: 'image/png', width: 1024, height: 768 }, { url: 'https://cdn/b.png', content_type: 'image/png', width: 1024, height: 768 }] })
    if (u.startsWith('https://cdn/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
    return Response.json({}, { status: 404 })
  }
  const json = async (path, init) => { const res = await app.fetch(new Request(`http://api${path}`, init), env); return { status: res.status, body: await res.json(), headers: res.headers } }
  const generate = async () => {
    const { body } = await json('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'image', modelId: 'nano-banana-pro', prompt: '  un chat sur un toit  ', resolution: '1K', count: 2, requestId: 'demande-0001' }) })
    await json(`/jobs/${body.jobId}`) // en cours
    phase = 'done'
    await json(`/jobs/${body.jobId}`) // terminée : sorties copiées dans R2
    return body.jobId
  }
  return { db, env, json, generate, objects, rows: (sql) => db.raw.prepare(sql).all(), restore: () => { globalThis.fetch = real } }
}

test('une génération terminée : sa ligne dans `jobs` et un fichier par sortie dans `assets`, rendus par GET /assets', async () => {
  const t = setup()
  try {
    const jobId = await t.generate()
    const [job] = t.rows('SELECT * FROM jobs')
    assert.equal(job.id, jobId)
    assert.equal(job.user_id, 'demo')
    assert.equal(job.status, 'COMPLETED')
    assert.equal(job.prompt, 'un chat sur un toit')
    assert.equal(JSON.parse(job.params).resolution, '1K')
    assert.equal(JSON.parse(job.params).requestId, undefined) // ni la clé de demande ni le texte dans les réglages
    assert.ok(job.started_at && job.finished_at >= job.started_at)
    assert.equal(JSON.parse(job.outputs).length, 2)

    const assets = t.rows('SELECT id, kind, r2_key, name, idx, width FROM assets ORDER BY idx')
    assert.equal(assets.length, 2)
    assert.equal(assets[0].r2_key, `outputs/demo/${jobId}/0.png`)
    assert.ok(t.objects.has(assets[1].r2_key))
    assert.equal(assets[1].name, 'un chat sur un toit · 2/2')
    assert.equal(assets[0].width, 1024)

    const list = await t.json('/assets?kind=image')
    assert.equal(list.body.assets.length, 2)
    assert.equal(list.body.assets[0].url, `http://api/files/outputs/demo/${jobId}/${list.body.assets[0].index}.png`)
    assert.equal((await t.json('/assets?kind=video')).body.assets.length, 0)

    // Interroger encore une génération terminée ne crée pas de doublon.
    await t.json(`/jobs/${jobId}`)
    assert.equal(t.rows('SELECT * FROM assets').length, 2)
  } finally { t.restore() }
})

test('sans R2, la génération est copiée mais aucun fichier (l’adresse de fal est temporaire)', async () => {
  const t = setup({ files: false })
  try {
    await t.generate()
    assert.equal(t.rows('SELECT status FROM jobs')[0].status, 'COMPLETED')
    assert.equal(t.rows('SELECT * FROM assets').length, 0)
  } finally { t.restore() }
})

test('suppression : le fichier disparaît de la bibliothèque (et de mes favoris), une seule fois', async () => {
  const t = setup()
  try {
    const jobId = await t.generate()
    const id = `${jobId}:0`
    assert.equal((await t.json(`/favorites/mine/${encodeURIComponent(id)}`, { method: 'PUT' })).status, 200)
    assert.equal((await t.json(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' })).status, 200)
    assert.equal((await t.json(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' })).status, 404)
    assert.deepEqual((await t.json('/assets')).body.assets.map((a) => a.id), [`${jobId}:1`])
    assert.equal((await t.json('/favorites')).body.favorites.length, 0)
    assert.ok(t.rows('SELECT deleted_at FROM assets WHERE idx = 0')[0].deleted_at) // la ligne reste, marquée
    // Le fichier supprimé n'est plus dans R2 ni servi ; l'autre sortie de la génération reste.
    assert.deepEqual([...t.objects.keys()], [`outputs/demo/${jobId}/1.png`])
    assert.equal((await t.env.FILES.get(`outputs/demo/${jobId}/0.png`)) ?? null, null)
    assert.equal((await app.fetch(new Request(`http://api/files/outputs/demo/${jobId}/0.png`), t.env)).status, 404)
    assert.equal((await app.fetch(new Request(`http://api/files/outputs/demo/${jobId}/1.png`), t.env)).status, 200)
  } finally { t.restore() }
})

test('favoris : ajout idempotent, retrait, portée et identifiant contrôlés', async () => {
  const t = setup()
  try {
    await t.json('/favorites/yeleen/perso-1', { method: 'PUT' })
    await t.json('/favorites/yeleen/perso-1', { method: 'PUT' })
    await t.json('/favorites/mine/job-1:0', { method: 'PUT' })
    const favs = (await t.json('/favorites')).body.favorites
    assert.deepEqual(favs.map((f) => `${f.scope}/${f.id}`).sort(), ['mine/job-1:0', 'yeleen/perso-1'])
    await t.json('/favorites/yeleen/perso-1', { method: 'DELETE' })
    assert.equal((await t.json('/favorites')).body.favorites.length, 1)
    assert.equal((await t.json('/favorites/autre/x', { method: 'PUT' })).status, 400)
    assert.equal((await t.json(`/favorites/mine/${'x'.repeat(200)}`, { method: 'PUT' })).status, 400)
  } finally { t.restore() }
})

test('Bibliothèque Yeleen : publique, publiés seulement, dans l’ordre, au format de yeleen.json', async () => {
  const t = setup({ vars: { ENV: 'production', CLERK_ISSUER: 'https://clerk.example' } }) // en production : tout le reste exige une connexion
  try {
    const ins = t.db.raw.prepare('INSERT INTO catalog_items (id, kind, category, name, url, art, seed, placeholder, sort, published, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
    ins.run('b', 'image', 'object', 'Calebasse', 'https://cdn/b.png', null, 2, 0, 2, 1)
    ins.run('a', 'image', 'character', 'Awa', null, '{"hue":30}', 1, 1, 1, 1)
    ins.run('c', 'video', 'video', 'Brouillon', 'https://cdn/c.mp4', null, 3, 0, 0, 0)
    const res = await t.json('/catalog')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('cache-control'), /max-age=300/)
    assert.deepEqual(res.body.items.map((e) => e.id), ['a', 'b'])
    assert.deepEqual(res.body.items[0], { id: 'a', kind: 'image', category: 'character', name: 'Awa', art: { hue: 30 }, seed: 1, placeholder: true })
    assert.equal((await t.json('/assets')).status, 401) // la bibliothèque personnelle, elle, reste protégée
  } finally { t.restore() }
})

test('Vidéos à refaire : publiques, publiées seulement, dans l’ordre, fichiers servis par /files/templates/', async () => {
  const t = setup({ vars: { ENV: 'production', CLERK_ISSUER: 'https://clerk.example' } })
  try {
    const ins = t.db.raw.prepare(`INSERT INTO templates (id, name, blurb, category, video_key, model_id, plans, resolution, ratio, sound, photo, sort, published, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    ins.run('maquis', 'Pub de maquis', 'Le soir au maquis, puis le plat en gros plan', 'pub', 'templates/maquis/video.mp4', 'kling-4', '[{"text":"Un maquis le soir","dur":5},{"text":"Gros plan sur le plat","dur":5}]', '1080p', '9:16', 1, 'Une photo de votre plat', 1, 1)
    ins.run('fete', 'Tabaski', null, 'fete', 'templates/fete/video.mp4', 'wan-3', '[{"text":"Une famille réunie","dur":8}]', '720p', 'auto', 0, null, 0, 1)
    ins.run('brouillon', 'Pas prêt', null, 'pub', 'templates/b/video.mp4', 'wan-3', '[{"text":"x","dur":5}]', null, null, 1, null, 2, 0)
    ins.run('casse', 'Plans illisibles', null, 'pub', 'templates/c/video.mp4', 'wan-3', 'pas du json', null, null, 1, null, 3, 1)
    const calls = t.db.calls
    const res = await t.json('/templates')
    assert.equal(res.status, 200)
    assert.equal(t.db.calls - calls, 1) // modèles et entrées lus dans un seul batch (même instantané)
    assert.match(res.headers.get('cache-control'), /max-age=300/)
    assert.deepEqual(res.body.templates.map((x) => x.id), ['fete', 'maquis'])
    assert.deepEqual(res.body.templates[1], {
      id: 'maquis', name: 'Pub de maquis', blurb: 'Le soir au maquis, puis le plat en gros plan', category: 'pub', video: 'http://api/files/templates/maquis/video.mp4', image: null,
      modelId: 'kling-4', plans: [{ text: 'Un maquis le soir', dur: 5 }, { text: 'Gros plan sur le plat', dur: 5 }], resolution: '1080p', ratio: '9:16', sound: true, photo: 'Une photo de votre plat', // ancienne forme sans consigne d'image : la photo est l'image de début à fournir
      inputs: [{ idx: 0, slot: 'start', kind: 'image', mode: 'user', label: 'Une photo de votre plat', optional: false }],
    })

    t.objects.set('templates/maquis/video.mp4', { buf: new Uint8Array([1, 2, 3]).buffer, type: 'video/mp4' })
    const file = await app.fetch(new Request('http://api/files/templates/maquis/video.mp4'), t.env)
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('content-type'), 'video/mp4')
    assert.equal((await app.fetch(new Request('http://api/files/autre/x.mp4'), t.env)).status, 404) // les autres dossiers restent fermés
  } finally { t.restore() }
})

test('seeds/templates.sql : se charge, et chaque vidéo à refaire est une demande valide pour son modèle', async () => {
  const { priceJob } = await import('../src/pricing.js')
  const t = setup()
  try {
    t.db.exec(readFileSync(new URL('../seeds/templates.sql', import.meta.url), 'utf8'))
    t.db.exec(readFileSync(new URL('../seeds/templates.sql', import.meta.url), 'utf8')) // rejouable
    const { body } = await t.json('/templates')
    assert.equal(body.templates.length, 18)
    for (const x of body.templates) {
      assert.match(x.video, /\/files\/templates\/[\w-]+\/video\.mp4$/)
      const secs = x.plans.reduce((n, p) => n + p.dur, 0)
      const r = priceJob({ kind: 'video', modelId: x.modelId, plans: x.plans, secs, resolution: x.resolution, ratio: x.ratio, sound: x.sound, ...(x.photo ? { startImageUrl: 'https://v3b.fal.media/files/a.png' } : {}) })
      assert.ok(r.ok, `${x.id} : ${r.error}`)
      // L'image de départ (Krea 3) : retouche de la photo, ou image créée du texte seul, au format de la vidéo
      assert.ok(x.image, `${x.id} : image`)
      const img = x.photo
        ? priceJob({ kind: 'tool', modelId: 'template-image', inputs: { model: 'krea-3', images: ['https://v3b.fal.media/files/a.png'], prompt: x.image, ratio: x.ratio } })
        : priceJob({ kind: 'image', modelId: 'krea-3', prompt: x.image, resolution: '2K', ratio: x.ratio, count: 1 })
      assert.ok(img.ok, `${x.id} (image) : ${img.error}`)
    }
  } finally { t.restore() }
})

test('D1 absente : les routes de bibliothèque répondent 503', async () => {
  const t = setup()
  try {
    t.db.failing = true
    assert.equal((await t.json('/favorites/yeleen/x', { method: 'PUT' })).status, 503)
  } finally { t.restore() }
})

test('migrations : rejouées sur une base existante, sans erreur ni changement', () => {
  const db = testD1() // toutes les migrations déjà passées
  const dir = new URL('../migrations/', import.meta.url)
  const before = db.raw.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all()
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'))
  assert.deepEqual(db.raw.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(), before)
})

const send = (t, bytes, type, q = '') => t.json(`/assets${q}`, { method: 'POST', headers: { 'content-type': type, 'content-length': String(bytes.length) }, body: bytes, duplex: 'half' })

test('import : le fichier va dans R2 sous uploads/, une ligne `assets` (source upload), servi par /files', async () => {
  const t = setup()
  try {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const res = await send(t, png, 'image/png', '?name=Logo%20Maquis&width=512&height=256')
    assert.equal(res.status, 201)
    const a = res.body.asset
    assert.match(a.id, /^up-[0-9a-f-]{36}$/)
    assert.deepEqual([a.source, a.kind, a.name, a.bytes, a.width, a.height], ['upload', 'image', 'Logo Maquis', 7, 512, 256])
    assert.equal(a.url, `http://api/files/uploads/demo/${a.id}.png`)
    assert.ok(t.objects.has(`uploads/demo/${a.id}.png`))
    assert.deepEqual((await t.json('/assets')).body.assets.map((x) => x.id), [a.id])
    const served = await app.fetch(new Request(a.url), t.env)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/png')
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff') // jamais lu comme une page
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), png)
    // Supprimé : retiré de la bibliothèque et effacé de R2.
    assert.equal((await t.json(`/assets/${a.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await t.json('/assets')).body.assets.length, 0)
    assert.equal([...t.objects.keys()].filter((k) => k.startsWith('uploads/')).length, 0)
  } finally { t.restore() }
})

test('import : vidéo et audio acceptés, durée gardée ; nom par défaut, caractères de contrôle retirés', async () => {
  const t = setup()
  try {
    const v = await send(t, new Uint8Array(10), 'video/mp4', '?secs=12.5')
    assert.deepEqual([v.status, v.body.asset.kind, v.body.asset.secs, v.body.asset.name], [201, 'video', 12.5, 'Fichier importé'])
    const s = await send(t, new Uint8Array(4), 'audio/mpeg', '?name=voix%0Aoff&secs=abc')
    assert.deepEqual([s.body.asset.kind, s.body.asset.name, s.body.asset.secs], ['audio', 'voixoff', null])
  } finally { t.restore() }
})

test('import refusé : type, taille, longueur absente, sans R2 ; D1 en panne → rien ne reste dans R2', async () => {
  const t = setup()
  try {
    assert.equal((await send(t, new Uint8Array(4), 'application/pdf')).status, 415)
    const big = await t.json('/assets', { method: 'POST', headers: { 'content-type': 'image/png', 'content-length': String(26 * 1024 * 1024) }, body: new Uint8Array(4), duplex: 'half' })
    assert.equal(big.status, 413)
    assert.equal((await t.json('/assets', { method: 'POST', headers: { 'content-type': 'image/png' } })).status, 411)
    t.db.failing = true
    assert.equal((await send(t, new Uint8Array(4), 'image/png')).status, 503)
    assert.equal([...t.objects.keys()].filter((k) => k.startsWith('uploads/')).length, 0)
  } finally { t.restore() }
  const off = setup({ files: false })
  try { assert.equal((await send(off, new Uint8Array(4), 'image/png')).status, 503) } finally { off.restore() }
})

test('import rejoué avec la même clé (réponse perdue) : le même asset, pas de doublon', async () => {
  const t = setup()
  try {
    const png = new Uint8Array([137, 80, 78, 71, 9])
    const first = await send(t, png, 'image/png', '?name=logo&key=a-lz3k9-abcde')
    assert.equal(first.status, 201)
    assert.match(first.body.asset.id, /^up-[0-9a-f]{32}$/)
    const again = await send(t, png, 'image/png', '?name=logo&key=a-lz3k9-abcde')
    assert.equal(again.status, 200)
    assert.equal(again.body.replay, true)
    assert.equal(again.body.asset.id, first.body.asset.id)
    assert.equal(t.rows('SELECT * FROM assets').length, 1)
    assert.equal([...t.objects.keys()].filter((k) => k.startsWith('uploads/')).length, 1)
    const other = await send(t, png, 'image/png', '?name=logo&key=a-lz3k9-fghij')
    assert.notEqual(other.body.asset.id, first.body.asset.id)
    assert.equal((await send(t, png, 'image/png', '?key=x')).status, 400) // clé trop courte
  } finally { t.restore() }
})

test('Vidéos à refaire par Genjutsu : listées avec outil, durée et rôles ; lancées avec la source et la consigne du serveur', async () => {
  const { findTool, toolCost } = await import('@studio/catalog/tools')
  const t = setup({ vars: { HIGGSFIELD_KEY: 'id:secret' } })
  const sent = []
  const fal = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.higgsfield.ai/')) { sent.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ status: 'queued', request_id: 'h1' }) }
    return fal(url, init)
  }
  try {
    t.db.raw.prepare(`INSERT INTO templates (id, name, blurb, category, video_key, model_id, plans, resolution, ratio, sound, photo, sort, published, created_at)
      VALUES ('duo', 'Duo', 'Deux danseurs', 'danse', 'templates/duo/video.mp4', 'motion-transfer', '[]', NULL, '9:16', 1, NULL, 0, 1, 1)`).run()
    t.db.raw.prepare(`INSERT INTO template_genjutsu (template_id, tool, source_key, secs, prompt, roles) VALUES ('duo', 'motion-transfer', 'templates/duo/source.mp4', 8.4, 'WHO IS WHO: left = PERSON A, right = PERSON B.', '["Personne A, à gauche","Personne B, à droite"]')`).run()
    const list = (await t.json('/templates')).body.templates
    assert.deepEqual(list[0].genjutsu, { tool: 'motion-transfer', secs: 8.4, roles: ['Personne A, à gauche', 'Personne B, à droite'] })
    assert.deepEqual(list[0].plans, [])
    assert.equal('prompt' in list[0].genjutsu || 'sourceKey' in list[0].genjutsu, false) // la source et la consigne restent sur le serveur

    const photo = (n) => `https://v3b.fal.media/files/b/x/p${n}.jpg`
    const send = (body) => t.json('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'tool', modelId: 'motion-transfer', ...body }) })
    assert.equal((await send({ template: 'duo', inputs: { images: [photo(1)], resolution: '480p' } })).body.error, 'invalid_file_url') // une photo par rôle
    assert.equal((await send({ template: 'inconnu', inputs: { images: [photo(1), photo(2)] } })).body.error, 'unknown_template')
    assert.equal((await send({ modelId: 'object-swap', template: 'duo', inputs: { images: [photo(1), photo(2)] } })).body.error, 'unknown_template')
    // La vidéo et la consigne envoyées par l'application sont ignorées : celles du modèle font foi.
    const ok = await send({ template: 'duo', inputs: { images: [photo(1), photo(2)], resolution: '480p', video: 'https://v3b.fal.media/files/b/x/autre.mp4', prompt: 'autre chose' }, requestId: 'genjutsu-0001' })
    assert.equal(ok.status, 202)
    assert.equal(ok.body.cost, toolCost(findTool('motion-transfer'), { resolution: '480p' }, 8.4)) // 9 s facturées
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, 'https://api.higgsfield.ai/higgsfield/genjutsu/motion-transfer/v1.0')
    assert.deepEqual(sent[0].body, { video_url: 'http://api/files/templates/duo/source.mp4', image_urls: [photo(1), photo(2)], resolution: '480p', prompt: 'WHO IS WHO: left = PERSON A, right = PERSON B.' })
  } finally { globalThis.fetch = fal; t.restore() }
})

test('seeds/genjutsu.sql : se charge après templates.sql, et chaque vidéo Genjutsu est une demande valide sous le plafond', async () => {
  const { priceJob } = await import('../src/pricing.js')
  const { templateSource } = await import('../src/library.js')
  const t = setup()
  try {
    for (const f of ['templates.sql', 'genjutsu.sql', 'genjutsu.sql']) t.db.exec(readFileSync(new URL(`../seeds/${f}`, import.meta.url), 'utf8')) // rejouable
    const { body } = await t.json('/templates')
    const g = body.templates.filter((x) => x.genjutsu)
    assert.equal(g.length, 16)
    assert.equal(body.templates.length, 34)
    for (const x of g) {
      assert.equal(x.modelId, x.genjutsu.tool)
      const src = await templateSource(t.db, x.id)
      assert.match(src.sourceKey, /^templates\/[\w-]+\/source\.mp4$/)
      assert.ok(src.secs >= 4 && src.secs <= 20, `${x.id} : ${src.secs} s`)
      assert.ok(src.prompt.length <= 2000, `${x.id} : consigne trop longue`)
      for (const resolution of ['480p', '720p']) {
        const url = `http://api/files/${src.sourceKey}`
        const r = priceJob({ kind: 'tool', modelId: src.tool, inputs: { video: url, images: x.genjutsu.roles.map((_, i) => `https://v3b.fal.media/files/p${i}.jpg`), prompt: src.prompt, resolution } }, { secs: src.secs, trusted: url })
        assert.ok(r.ok, `${x.id} : ${r.error}`)
        assert.ok(r.cost <= 600, `${x.id} ${resolution} : ${r.cost}`)
      }
    }
  } finally { t.restore() }
})

test('vidéo à refaire, audio vers vidéo : un audio fixe du modèle (non mesuré) est facturé pour la durée maximale', async () => {
  const { VIDEO_MODELS, findModel, videoCost } = await import('@studio/catalog')
  const t = setup()
  const sent = []
  const fal = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://queue.fal.run/fal-ai/ltx-2.3/audio-to-video')) { sent.push(JSON.parse(init.body)); return Response.json({ request_id: 'r1', status_url: 'https://q/x/status', response_url: 'https://q/x', cancel_url: 'https://q/x/cancel' }) }
    return fal(url, init)
  }
  try {
    t.db.raw.prepare(`INSERT INTO templates (id, name, blurb, category, video_key, model_id, plans, resolution, ratio, sound, photo, sort, published, created_at)
      VALUES ('chant', 'Chant', 'Une chanson', 'musique', 'templates/chant/video.mp4', 'ltx-2-3-a2v', '[{"text":"une chanteuse","dur":5}]', NULL, 'auto', 1, NULL, 0, 1, 1)`).run()
    t.db.raw.prepare("INSERT INTO template_inputs (template_id, idx, slot, kind, mode, file_key) VALUES ('chant', 0, 'audio', 'audio', 'fixed', 'templates/chant/voix.mp3')").run()
    const res = await t.json('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'video', modelId: 'ltx-2-3-a2v', template: 'chant', plans: [{ text: 'une chanteuse', dur: 2 }], secs: 2, ratio: 'auto' }) })
    assert.equal(res.status, 202)
    assert.equal(res.body.cost, videoCost(findModel(VIDEO_MODELS, 'ltx-2-3-a2v'), 10)) // 10 s : le maximum du modèle, pas les 2 s annoncées
    assert.equal(sent[0].audio_url, 'http://api/files/templates/chant/voix.mp3')
  } finally { globalThis.fetch = fal; t.restore() }
})

test('vidéo à refaire, audio vers vidéo : un audio fixe mesurable (MP3 dans R2) est facturé pour sa durée, pas pour le maximum', async () => {
  const { VIDEO_MODELS, findModel, videoCost } = await import('@studio/catalog')
  const { frames } = await import('./media.test.js')
  const t = setup()
  const fal = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://queue.fal.run/fal-ai/ltx-2.3/audio-to-video')) return Response.json({ request_id: 'r1', status_url: 'https://q/x/status', response_url: 'https://q/x', cancel_url: 'https://q/x/cancel' })
    return fal(url, init)
  }
  try {
    t.db.raw.prepare(`INSERT INTO templates (id, name, blurb, category, video_key, model_id, plans, resolution, ratio, sound, photo, sort, published, created_at)
      VALUES ('chant', 'Chant', 'Une chanson', 'musique', 'templates/chant/video.mp4', 'ltx-2-3-a2v', '[{"text":"une chanteuse","dur":4}]', NULL, 'auto', 1, NULL, 0, 1, 1)`).run()
    t.db.raw.prepare("INSERT INTO template_inputs (template_id, idx, slot, kind, mode, file_key) VALUES ('chant', 0, 'audio', 'audio', 'fixed', 'templates/chant/voix.mp3')").run()
    const mp3 = frames(128, Math.round((4 * 44100) / 1152)) // 4 s
    await t.env.FILES.put('templates/chant/voix.mp3', mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength), { httpMetadata: { contentType: 'audio/mpeg' } })
    const res = await t.json('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'video', modelId: 'ltx-2-3-a2v', template: 'chant', plans: [{ text: 'une chanteuse', dur: 2 }], secs: 2, ratio: 'auto' }) })
    assert.equal(res.status, 202)
    assert.equal(res.body.cost, videoCost(findModel(VIDEO_MODELS, 'ltx-2-3-a2v'), 4)) // ni les 2 s annoncées ni le maximum (10 s)
  } finally { globalThis.fetch = fal; t.restore() }
})

test('suppression : R2 en panne ou fichier déjà absent, la demande réussit quand même ; une nouvelle demande efface le fichier resté', async () => {
  const t = setup()
  const quiet = console.error
  const logged = []
  console.error = (...a) => logged.push(a.join(' '))
  try {
    const a = (await send(t, new Uint8Array([1, 2, 3]), 'image/png')).body.asset
    const key = `uploads/demo/${a.id}.png`
    const del = t.env.FILES.delete
    t.env.FILES.delete = async () => { throw new Error('R2 indisponible') }
    assert.equal((await t.json(`/assets/${a.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await t.json('/assets')).body.assets.length, 0)
    assert.ok(t.rows('SELECT deleted_at FROM assets')[0].deleted_at)
    assert.ok(t.objects.has(key)) // resté dans R2, noté dans le journal
    assert.ok(logged.some((l) => l.includes(key)))
    t.env.FILES.delete = del
    assert.equal((await t.json(`/assets/${a.id}`, { method: 'DELETE' })).status, 404) // déjà supprimé, mais le fichier est effacé cette fois
    assert.equal(t.objects.has(key), false)
    // Fichier déjà absent de R2 : pas une erreur.
    const b = (await send(t, new Uint8Array([4, 5]), 'image/png')).body.asset
    t.objects.delete(`uploads/demo/${b.id}.png`)
    assert.equal((await t.json(`/assets/${b.id}`, { method: 'DELETE' })).status, 200)
  } finally { console.error = quiet; t.restore() }
})

test('suppression : le fichier d’un autre compte n’est pas touché ; une clé encore utilisée par une ligne visible est gardée', async () => {
  const t = setup()
  try {
    const a = (await send(t, new Uint8Array([1, 2, 3]), 'image/png')).body.asset
    const key = `uploads/demo/${a.id}.png`
    t.db.raw.prepare('UPDATE assets SET user_id = ?1 WHERE id = ?2').run('autre', a.id)
    assert.equal((await t.json(`/assets/${a.id}`, { method: 'DELETE' })).status, 404)
    assert.ok(t.objects.has(key))
    assert.equal(t.rows('SELECT deleted_at FROM assets')[0].deleted_at, null)
    // Deux lignes sur la même clé (ne devrait pas arriver, mais rien ne l'interdit en base) : le fichier reste tant que l'une est visible.
    t.db.raw.prepare('UPDATE assets SET user_id = ?1 WHERE id = ?2').run('demo', a.id)
    t.db.raw.prepare("INSERT INTO assets (id, user_id, kind, source, name, r2_key, created_at) VALUES ('copie', 'autre', 'image', 'upload', 'copie', ?1, 1)").run(key)
    assert.equal((await t.json(`/assets/${a.id}`, { method: 'DELETE' })).status, 200)
    assert.ok(t.objects.has(key))
    assert.equal((await app.fetch(new Request(`http://api/files/${key}`), t.env)).status, 200)
  } finally { t.restore() }
})

test('import rejoué après suppression : jamais l’ancienne ligne sans fichier, le fichier est réécrit et la ligne revient', async () => {
  const t = setup()
  try {
    const png = new Uint8Array([137, 80, 78, 71, 9])
    const first = await send(t, png, 'image/png', '?name=logo&key=a-lz3k9-abcde')
    assert.equal((await t.json(`/assets/${first.body.asset.id}`, { method: 'DELETE' })).status, 200)
    assert.equal(t.objects.size, 0)
    const again = await send(t, new Uint8Array([137, 80, 78, 71, 9, 9]), 'image/png', '?name=logo%20bis&key=a-lz3k9-abcde')
    assert.equal(again.status, 201)
    assert.equal(again.body.replay, undefined)
    assert.deepEqual([again.body.asset.id, again.body.asset.name, again.body.asset.bytes], [first.body.asset.id, 'logo bis', 6])
    const served = await app.fetch(new Request(again.body.asset.url), t.env)
    assert.equal(served.status, 200)
    assert.equal((await served.arrayBuffer()).byteLength, 6)
    assert.deepEqual((await t.json('/assets')).body.assets.map((a) => a.id), [first.body.asset.id])
    assert.equal(t.rows('SELECT * FROM assets').length, 1)
    // Rejoué tant qu'il est visible : toujours le même asset, rien n'est réécrit.
    assert.equal((await send(t, png, 'image/png', '?key=a-lz3k9-abcde')).body.replay, true)
    // Supprimé puis renvoyé sous un autre type : l'ancienne clé ne traîne pas.
    assert.equal((await t.json(`/assets/${first.body.asset.id}`, { method: 'DELETE' })).status, 200)
    const jpg = await send(t, new Uint8Array([1, 2]), 'image/jpeg', '?key=a-lz3k9-abcde')
    assert.equal(jpg.status, 201)
    assert.deepEqual([...t.objects.keys()], [`uploads/demo/${first.body.asset.id}.jpg`])
    // Le même contenu sans clé : un nouvel asset, comme avant.
    assert.equal((await send(t, png, 'image/png')).status, 201)
  } finally { t.restore() }
})

test('import rejoué après suppression : si une suppression en cours efface le fichier juste après son écriture, la ligne ne reste pas visible sans fichier', async () => {
  const t = setup()
  try {
    const png = new Uint8Array([137, 80, 78, 71, 9])
    const first = await send(t, png, 'image/png', '?key=a-lz3k9-course')
    const key = `uploads/demo/${first.body.asset.id}.png`
    assert.equal((await t.json(`/assets/${first.body.asset.id}`, { method: 'DELETE' })).status, 200)
    // La fin d'une suppression (effacement dans R2) tombe entre l'écriture du fichier et le retour de la ligne.
    const put = t.env.FILES.put
    t.env.FILES.put = async (...a) => { const r = await put(...a); t.objects.delete(key); return r }
    const lost = await send(t, png, 'image/png', '?key=a-lz3k9-course')
    t.env.FILES.put = put
    assert.equal(lost.status, 503)
    assert.equal((await t.json('/assets')).body.assets.length, 0)
    assert.ok(t.rows('SELECT deleted_at FROM assets')[0].deleted_at)
    // Le nouvel essai refait l'import en entier.
    const again = await send(t, png, 'image/png', '?key=a-lz3k9-course')
    assert.equal(again.status, 201)
    assert.equal((await app.fetch(new Request(again.body.asset.url), t.env)).status, 200)
  } finally { t.restore() }
})

test('import rejoué après suppression : si D1 refuse, le fichier réécrit ne reste pas dans R2 ; l’ancienne clé encore utilisée ailleurs est gardée', async () => {
  const t = setup()
  const quiet = console.error
  console.error = () => {}
  try {
    const png = new Uint8Array([137, 80, 78, 71, 9])
    const first = await send(t, png, 'image/png', '?key=a-lz3k9-refus')
    const id = first.body.asset.id
    assert.equal((await t.json(`/assets/${id}`, { method: 'DELETE' })).status, 200)
    const prepare = t.env.DB.prepare
    t.env.DB.prepare = (sql) => { if (/UPDATE assets SET deleted_at = NULL/.test(sql)) throw new Error('D1 indisponible'); return prepare(sql) }
    assert.equal((await send(t, png, 'image/png', '?key=a-lz3k9-refus')).status, 503)
    t.env.DB.prepare = prepare
    assert.equal(t.objects.size, 0) // supprimé par l'utilisateur : pas de retour dans R2 sans ligne visible
    assert.ok(t.rows('SELECT deleted_at FROM assets')[0].deleted_at)
    // Renvoyé sous un autre type : l'ancienne clé n'est pas effacée si une autre ligne visible l'utilise (ne devrait pas arriver).
    const old = `uploads/demo/${id}.png`
    await t.env.FILES.put(old, png.buffer, { httpMetadata: { contentType: 'image/png' } })
    t.db.raw.prepare("INSERT INTO assets (id, user_id, kind, source, name, r2_key, created_at) VALUES ('copie', 'autre', 'image', 'upload', 'copie', ?1, 1)").run(old)
    assert.equal((await send(t, new Uint8Array([1, 2]), 'image/jpeg', '?key=a-lz3k9-refus')).status, 201)
    assert.deepEqual([...t.objects.keys()].sort(), [`uploads/demo/${id}.jpg`, old])
  } finally { console.error = quiet; t.restore() }
})
