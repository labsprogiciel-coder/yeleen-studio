import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account-do.js'
import { resetAuthCache } from '../src/auth.js'
import app from '../src/index.js'
import { resetUserCache } from '../src/users.js'
import { slug } from '../src/adminTemplates.js'
import { testD1 } from './d1.js'

beforeEach(() => resetUserCache())

const ISSUER = 'https://clerk.example.test'
const ORIGIN = 'https://yeleen.example.workers.dev'
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const JWKS = { keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] }
async function sign(sub) {
  const now = Math.floor(Date.now() / 1000)
  const head = enc({ alg: 'RS256', typ: 'JWT', kid: 'k1' })
  const body = enc({ iss: ISSUER, azp: ORIGIN, iat: now, nbf: now - 1, exp: now + 600, sub })
  const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`))).toString('base64url')
  return `${head}.${body}.${sig}`
}

/** L'API entière : comptes réels (Durable Object en mémoire), D1 (SQLite), faux bucket R2 (avec list), faux Runware et Higgsfield. */
function setup() {
  const db = testD1()
  const accounts = new Map()
  const account = (name) => {
    if (!accounts.has(name)) {
      const m = new Map()
      accounts.set(name, new Account({ storage: { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)) } } }, { ENV: 'dev', DB: db }))
    }
    return accounts.get(name)
  }
  const objects = new Map()
  const bucket = {
    put: async (key, body, opts) => {
      const buf = body instanceof ArrayBuffer ? body : body?.getReader ? await new Response(body).arrayBuffer() : body
      objects.set(key, { buf, type: opts?.httpMetadata?.contentType })
      return { size: buf?.byteLength ?? 0 }
    },
    get: async (key) => { const o = objects.get(key); return o && { body: new Uint8Array(o.buf), size: o.buf.byteLength, httpMetadata: { contentType: o.type } } },
    head: async (key) => { const o = objects.get(key); return o ? { key, size: o.buf?.byteLength ?? 0, httpMetadata: { contentType: o.type } } : null },
    delete: async (key) => { objects.delete(key) },
    // Pages de 2 objets : la suppression doit suivre le curseur.
    list: async ({ prefix, cursor }) => {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
      const from = Number(cursor ?? 0)
      const page = keys.slice(from, from + 2)
      return { objects: page.map((key) => ({ key })), truncated: from + 2 < keys.length, cursor: String(from + 2) }
    },
  }
  const env = {
    FAL_KEY: 'test', RUNWARE_KEY: 'rw', HIGGSFIELD_KEY: 'id:secret', ENV: 'production', CLERK_ISSUER: ISSUER, ALLOWED_ORIGINS: ORIGIN, DB: db, FILES: bucket,
    ADMIN_USER_IDS: 'user_admin',
    ACCOUNT: { idFromName: (n) => n, get: (name) => ({ fetch: (url, init) => account(name).fetch(new Request(url, init)) }) },
  }
  const t = { db, objects, bucket, sent: [] }
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.endsWith('/.well-known/jwks.json')) return Response.json(JWKS)
    if (u === 'https://api.runware.ai/v1') { t.sent.push({ url: u, body: JSON.parse(init.body)[0] }); return Response.json({ data: [] }) }
    if (u.startsWith('https://api.higgsfield.ai/')) { t.sent.push({ url: u, body: JSON.parse(init.body) }); return Response.json({ status: 'queued', request_id: 'h1' }) }
    return Response.json({ detail: 'inattendu' }, { status: 500 })
  }
  resetAuthCache()
  const tokens = {}
  t.as = async (sub, path, init = {}) => {
    tokens[sub] ??= await sign(sub)
    const res = await app.fetch(new Request(`http://api${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${tokens[sub]}` } }), env)
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* texte */ }
    return { status: res.status, body, headers: res.headers }
  }
  t.admin = (path, init) => t.as('user_admin', path, init)
  t.public = async (path) => { const res = await app.fetch(new Request(`http://api${path}`), env); return { status: res.status, body: await res.json() } }
  t.rows = (sql, ...args) => db.raw.prepare(sql).all(...args)
  t.restore = () => { globalThis.fetch = real }
  return t
}
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const F = (n) => `https://v3b.fal.media/files/b/x/u${n}.png`
/** Corps d'enregistrement complet d'un modèle Seedance (à compléter). */
const seedance = (over = {}) => ({
  name: 'Pub du marché', blurb: 'Le marché le matin', category: 'pub', videoKey: '', modelId: 'seedance-2-5', plans: [{ text: '@Image1 au marché, puis @Image2', dur: 5 }],
  resolution: '480p', ratio: '9:16', sound: true, genjutsu: null,
  inputs: [
    { idx: 0, slot: 'reference', kind: 'image', mode: 'fixed', file: 'templates/x/decor.png' },
    { idx: 1, slot: 'reference', kind: 'image', mode: 'user', label: 'Votre produit', optional: false },
  ],
  ...over,
})
/** Insère un modèle directement dans D1 (ancienne forme ou non). */
const insert = (t, id, { model = 'seedance-2-5', plans = '[{"text":"Un plan","dur":5}]', image = null, photo = null, published = 1, sort = 0, video = `templates/${id}/video.mp4` } = {}) =>
  t.db.raw.prepare(`INSERT INTO templates (id, name, blurb, category, video_key, image, model_id, plans, resolution, ratio, sound, photo, sort, published, created_at)
    VALUES (?, ?, NULL, 'pub', ?, ?, ?, ?, '480p', '9:16', 1, ?, ?, ?, 1)`).run(id, id, video, image, model, plans, photo, sort, published)

test('modèles (administration) : réservés aux administrateurs ; jamais gardés en cache', async () => {
  const t = setup()
  try {
    for (const [path, init] of [['/admin/templates'], ['/admin/templates', json('POST', { name: 'x' })], ['/admin/templates/a', json('PUT', seedance())], ['/admin/templates/a/preview']]) {
      assert.equal((await t.as('user_alice', path, init)).status, 403, path)
    }
    const r = await t.admin('/admin/templates')
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.templates, [])
    assert.equal(r.headers.get('cache-control'), 'no-store')
  } finally { t.restore() }
})

test('création : identifiant tiré du nom, brouillon Seedance à la fin de la liste, problèmes affichés, journal', async () => {
  const t = setup()
  try {
    insert(t, 'ancien', { sort: 7 })
    assert.match(slug('Fête de l’Été 2026 !'), /^fete-de-l-ete-2026-[a-z0-9]{4}$/)
    assert.match(slug('x'.repeat(60)), /^x{40}-[a-z0-9]{4}$/)
    assert.equal((await t.admin('/admin/templates', json('POST', { name: '  ' }))).status, 400)
    const r = await t.admin('/admin/templates', json('POST', { name: 'Pub de maquis' }))
    assert.equal(r.status, 201)
    const x = r.body.template
    assert.match(x.id, /^pub-de-maquis-[a-z0-9]{4}$/)
    assert.deepEqual([x.name, x.category, x.videoKey, x.video, x.modelId, x.plans, x.resolution, x.ratio, x.sound, x.sort, x.published, x.inputs, x.genjutsu],
      ['Pub de maquis', 'autres', '', null, 'seedance-2-5', [{ text: '', dur: 5 }], null, null, true, 8, false, [], null])
    assert.deepEqual(x.issues, [{ code: 'no_video' }, { code: 'empty_plan' }])
    assert.deepEqual((await t.admin('/admin/templates')).body.templates.map((y) => y.id), ['ancien', x.id])
    assert.equal((await t.admin(`/admin/templates/${x.id}`)).body.template.id, x.id)
    assert.equal((await t.admin('/admin/templates/inconnu')).status, 404)
    assert.deepEqual(t.rows('SELECT actor, template_id, action FROM template_events').map((e) => ({ ...e })), [{ actor: 'user_admin', template_id: x.id, action: 'create' }])
  } finally { t.restore() }
})

test('enregistrement : champs contrôlés, entrées inutilisables refusées, problèmes de capacité gardés pour un brouillon', async () => {
  const t = setup()
  try {
    const { id } = (await t.admin('/admin/templates', json('POST', { name: 'Essai' }))).body.template
    const put = (body) => t.admin(`/admin/templates/${id}`, json('PUT', body))
    const refused = async (body, code, field) => {
      const r = await put(body)
      assert.equal(r.status, 400, JSON.stringify(r.body))
      assert.equal(r.body.error, 'invalid_template')
      assert.ok(r.body.issues.some((i) => i.code === code && (field == null || i.field === field)), `${code} ${field ?? ''} : ${JSON.stringify(r.body.issues)}`)
    }
    await refused(seedance({ name: '' }), 'invalid_field', 'name')
    await refused(seedance({ name: 'x'.repeat(81) }), 'invalid_field', 'name')
    await refused(seedance({ blurb: 'x'.repeat(161) }), 'invalid_field', 'blurb')
    await refused(seedance({ category: 'Pub !' }), 'invalid_field', 'category')
    await refused(seedance({ videoKey: 'uploads/demo/a.mp4' }), 'invalid_field', 'videoKey')
    await refused(seedance({ modelId: 'retire' }), 'unknown_model')
    await refused(seedance({ plans: [{ text: 'a', dur: 3 }, { text: 'b', dur: 2 }] }), 'bad_plans') // Seedance : un seul plan
    await refused(seedance({ plans: [{ text: 'a', dur: 0 }] }), 'bad_plans')
    await refused(seedance({ resolution: '4K' }), 'invalid_field', 'resolution')
    await refused(seedance({ ratio: '2:1' }), 'invalid_field', 'ratio')
    await refused(seedance({ sound: 'oui' }), 'invalid_field', 'sound')
    await refused(seedance({ inputs: [{ idx: 0, slot: 'reference', kind: 'image', mode: 'fixed', file: 'outputs/a/b.png' }] }), 'invalid_field', 'inputs.file')
    await refused(seedance({ inputs: [{ idx: 0, slot: 'start', kind: 'video', mode: 'user', label: 'x' }] }), 'bad_kind')
    await refused(seedance({ inputs: [{ idx: 0, slot: 'start', kind: 'image', mode: 'user' }, { idx: 0, slot: 'end', kind: 'image', mode: 'user' }] }), 'bad_idx')
    await refused(seedance({ inputs: 'non' }), 'bad_inputs')
    assert.equal(t.rows('SELECT * FROM template_inputs').length, 0)

    // Kling 3 sans image de début : enregistré (brouillon), le problème est montré ; image et photo vidées, entrées remplacées.
    t.db.raw.prepare("UPDATE templates SET image = 'ancienne consigne', photo = 'ancienne photo' WHERE id = ?").run(id)
    const ok = await put(seedance({ modelId: 'kling-3-pro', resolution: null, ratio: null, plans: [{ text: '@Element1 danse', dur: 5 }, { text: 'fin', dur: 5 }],
      inputs: [{ idx: 0, slot: 'element', kind: 'image', mode: 'user', label: '  Votre   photo ', optional: true }, { idx: 1, slot: 'element', kind: 'image', mode: 'fixed' }] }))
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    const x = ok.body.template
    assert.deepEqual(x.issues.map((i) => i.code).sort(), ['fixed_needs_file', 'no_video', 'optional_not_last', 'start_required']) // @Element1 facultatif avant @Element2
    assert.deepEqual(x.inputs, [
      { idx: 0, slot: 'element', kind: 'image', mode: 'user', label: 'Votre   photo', optional: true },
      { idx: 1, slot: 'element', kind: 'image', mode: 'fixed', optional: false },
    ])
    assert.deepEqual({ ...t.rows('SELECT image, photo FROM templates WHERE id = ?', id)[0] }, { image: null, photo: null })
    assert.equal(t.rows('SELECT * FROM template_inputs').length, 2)
    const again = await put(seedance())
    assert.equal(again.status, 200)
    assert.deepEqual(again.body.template.inputs.map((i) => i.mode), ['fixed', 'user'])
    assert.equal(again.body.template.inputs[0].url, 'http://api/files/templates/x/decor.png')
    assert.equal(t.rows('SELECT * FROM template_inputs').length, 2)
    assert.equal(t.rows("SELECT * FROM template_events WHERE action = 'update'").length, 2)
  } finally { t.restore() }
})

test('publication : zéro problème et une vidéo ; un modèle publié ne s’enregistre pas avec un problème ; retrait toujours permis', async () => {
  const t = setup()
  try {
    const { id } = (await t.admin('/admin/templates', json('POST', { name: 'Pub' }))).body.template
    t.objects.set('templates/x/decor.png', { buf: new ArrayBuffer(1), type: 'image/png' })
    t.objects.set(`templates/${id}/aperçu.mp4`, { buf: new ArrayBuffer(1), type: 'video/mp4' })
    const publish = (published) => t.admin(`/admin/templates/${id}/publish`, json('POST', { published }))
    assert.equal((await publish('oui')).status, 400)
    await t.admin(`/admin/templates/${id}`, json('PUT', seedance()))
    const no = await publish(true)
    assert.equal(no.status, 422)
    assert.deepEqual(no.body, { error: 'invalid_template', issues: [{ code: 'no_video' }] })
    await t.admin(`/admin/templates/${id}`, json('PUT', seedance({ videoKey: `templates/${id}/aperçu.mp4` })))
    const yes = await publish(true)
    assert.equal(yes.status, 200)
    assert.equal(yes.body.template.published, true)
    assert.deepEqual((await t.public('/templates')).body.templates.map((x) => x.id), [id])
    // Publié : un problème de capacité refuse l'enregistrement (422), rien ne change.
    const bad = await t.admin(`/admin/templates/${id}`, json('PUT', seedance({ videoKey: `templates/${id}/aperçu.mp4`, inputs: [{ idx: 0, slot: 'start', kind: 'image', mode: 'user', label: 'x' }, { idx: 1, slot: 'reference', kind: 'image', mode: 'user', label: 'y' }] })))
    assert.equal(bad.status, 422)
    assert.ok(bad.body.issues.some((i) => i.code === 'frames_with_references'))
    assert.equal(t.rows('SELECT * FROM template_inputs WHERE mode = ?', 'fixed').length, 1)
    const off = await publish(false)
    assert.equal(off.body.template.published, false)
    assert.deepEqual((await t.public('/templates')).body.templates, [])
    assert.deepEqual(t.rows("SELECT action FROM template_events WHERE action IN ('publish','unpublish') ORDER BY at").map((e) => e.action), ['publish', 'unpublish'])
  } finally { t.restore() }
})

test('Genjutsu : enregistré dans template_genjutsu, incomplet signalé ; passer d’une forme à l’autre retire les données de l’autre', async () => {
  const t = setup()
  try {
    const { id } = (await t.admin('/admin/templates', json('POST', { name: 'Duo' }))).body.template
    for (const k of ['v.mp4', 'source.mp4']) t.objects.set(`templates/${id}/${k}`, { buf: new ArrayBuffer(1), type: 'video/mp4' })
    await t.admin(`/admin/templates/${id}`, json('PUT', seedance()))
    assert.equal(t.rows('SELECT * FROM template_inputs').length, 2)
    const g = { tool: 'motion-transfer', sourceKey: '', secs: 0, prompt: '', roles: [] }
    const base = { name: 'Duo', blurb: null, category: 'danse', videoKey: `templates/${id}/v.mp4`, ratio: '9:16', sound: true }
    assert.equal((await t.admin(`/admin/templates/${id}`, json('PUT', { ...base, genjutsu: { ...g, tool: 'autre' } }))).status, 400)
    assert.equal((await t.admin(`/admin/templates/${id}`, json('PUT', { ...base, genjutsu: { ...g, roles: Array(9).fill('x') } }))).status, 400)
    assert.equal((await t.admin(`/admin/templates/${id}`, json('PUT', { ...base, genjutsu: { ...g, sourceKey: 'ailleurs/a.mp4' } }))).status, 400)
    const draft = await t.admin(`/admin/templates/${id}`, json('PUT', { ...base, genjutsu: g }))
    assert.equal(draft.status, 200)
    assert.deepEqual(draft.body.template.issues, [{ code: 'genjutsu_incomplete' }])
    assert.equal(t.rows('SELECT * FROM template_inputs').length, 0)
    const full = { tool: 'object-swap', sourceKey: `templates/${id}/source.mp4`, secs: 8.4, prompt: 'A = gauche', roles: ['Personne A', ' Personne B '] }
    const ok = await t.admin(`/admin/templates/${id}`, json('PUT', { ...base, genjutsu: full }))
    const x = ok.body.template
    assert.deepEqual(x.issues, [])
    assert.deepEqual(x.genjutsu, { ...full, roles: ['Personne A', 'Personne B'], source: `http://api/files/templates/${id}/source.mp4` })
    assert.deepEqual([x.modelId, x.plans, x.inputs], ['object-swap', [], []])
    assert.equal(t.rows('SELECT plans FROM templates')[0].plans, '[]')
    assert.equal((await t.admin(`/admin/templates/${id}/publish`, json('POST', { published: true }))).status, 200)
    const pub = (await t.public('/templates')).body.templates[0]
    assert.deepEqual(pub.genjutsu, { tool: 'object-swap', secs: 8.4, roles: ['Personne A', 'Personne B'] })
    assert.deepEqual(pub.inputs, [])
    await t.admin(`/admin/templates/${id}/publish`, json('POST', { published: false }))
    await t.admin(`/admin/templates/${id}`, json('PUT', seedance()))
    assert.equal(t.rows('SELECT * FROM template_genjutsu').length, 0)
  } finally { t.restore() }
})

test('ordre : chaque identifiant doit exister ; la position devient `sort` ; journal sur « * »', async () => {
  const t = setup()
  try {
    insert(t, 'a', { sort: 0 }); insert(t, 'b', { sort: 1 }); insert(t, 'c', { sort: 2 })
    const order = (ids) => t.admin('/admin/templates/order', json('POST', { ids }))
    assert.equal((await order(['c', 'inconnu'])).status, 400)
    assert.equal((await order(['c', 'c'])).status, 400)
    assert.equal((await order('c')).status, 400)
    assert.deepEqual((await order(['c', 'a', 'b'])).body, { ok: true })
    assert.deepEqual((await t.admin('/admin/templates')).body.templates.map((x) => x.id), ['c', 'a', 'b'])
    assert.deepEqual((await t.public('/templates')).body.templates.map((x) => x.id), ['c', 'a', 'b'])
    assert.deepEqual({ ...t.rows("SELECT template_id, action FROM template_events")[0] }, { template_id: '*', action: 'order' })
  } finally { t.restore() }
})

test('suppression : lignes D1 et fichiers du dossier du modèle seulement (les autres clés restent)', async () => {
  const t = setup()
  try {
    insert(t, 'duo')
    t.db.raw.prepare("INSERT INTO template_genjutsu (template_id, tool, source_key, secs, prompt, roles) VALUES ('duo', 'motion-transfer', 'templates/duo/source.mp4', 8, 'p', '[\"A\"]')").run()
    t.db.raw.prepare("INSERT INTO template_inputs (template_id, idx, slot, kind, mode, file_key) VALUES ('duo', 0, 'reference', 'image', 'fixed', 'templates/partage/decor.png')").run()
    for (const k of ['templates/duo/video.mp4', 'templates/duo/source.mp4', 'templates/duo/a.png', 'templates/duo-2/video.mp4', 'templates/partage/decor.png']) t.objects.set(k, { buf: new ArrayBuffer(1) })
    const r = await t.admin('/admin/templates/duo', { method: 'DELETE' })
    assert.deepEqual(r.body, { ok: true })
    assert.deepEqual([...t.objects.keys()].sort(), ['templates/duo-2/video.mp4', 'templates/partage/decor.png'])
    for (const table of ['templates', 'template_genjutsu', 'template_inputs']) assert.equal(t.rows(`SELECT * FROM ${table}`).length, 0, table)
    assert.equal((await t.admin('/admin/templates/duo', { method: 'DELETE' })).status, 404)
    assert.equal(t.rows("SELECT * FROM template_events WHERE action = 'delete'").length, 1)
  } finally { t.restore() }
})

const bytes = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const ascii = (s) => [...s].map((ch) => ch.charCodeAt(0))
const box = (type, ...payload) => { const body = bytes(...payload); return bytes(u32(8 + body.length), ascii(type), body) }
/** MP4 minimal de `secs` secondes (voir media.test.js). */
const mp4 = (secs) => {
  const mvhd = box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(secs * 1000), new Array(80).fill(0))
  const tkhd = box('tkhd', [0, 0, 0, 0], new Array(72).fill(0), u32(1280 * 65536), u32(720 * 65536))
  return bytes(box('ftyp', ascii('isom'), u32(0)), box('moov', mvhd, box('trak', tkhd)))
}

test('dépôt de fichiers : rôle, type, longueur, tailles ; clé neuve sous templates/<id>/ ; durée d’une source mesurée', async () => {
  const t = setup()
  try {
    insert(t, 'pub')
    const up = (q, body, type, length = body.length) => t.admin(`/admin/templates/pub/files?${q}`, { method: 'POST', headers: { 'content-type': type, 'content-length': String(length) }, body, duplex: 'half' })
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
    assert.equal((await up('role=autre', png, 'image/png')).body.error, 'invalid_role')
    assert.equal((await t.admin('/admin/templates/inconnu/files?role=input', { method: 'POST', headers: { 'content-type': 'image/png', 'content-length': '5' }, body: png, duplex: 'half' })).status, 404)
    assert.equal((await up('role=video', png, 'image/png')).status, 415) // l'aperçu est une vidéo
    assert.equal((await up('role=input', png, 'image/gif')).status, 415)
    assert.equal((await t.admin('/admin/templates/pub/files?role=input', { method: 'POST', headers: { 'content-type': 'image/png' } })).status, 411)
    assert.equal((await up('role=input', png, 'image/png', 10 * 1024 * 1024 + 1)).status, 413)
    assert.equal((await up('role=input', png, 'audio/mpeg', 15 * 1024 * 1024 + 1)).status, 413)
    assert.equal((await up('role=video', png, 'video/mp4', 20 * 1024 * 1024 + 1)).body.error, 'too_large')
    assert.equal((await up('role=source', png, 'video/mp4', 100 * 1024 * 1024 + 1)).status, 413)
    assert.equal(t.objects.size, 0)

    const one = await up('role=input&name=decor.png', png, 'image/png')
    assert.equal(one.status, 201)
    assert.match(one.body.key, /^templates\/pub\/[a-z0-9]{12}\.png$/)
    assert.deepEqual([one.body.url, one.body.size, one.body.contentType, one.body.secs], [`http://api/files/${one.body.key}`, 9, 'image/png', undefined])
    assert.equal(t.objects.get(one.body.key).type, 'image/png')
    const two = await up('role=input', png, 'image/png')
    assert.notEqual(two.body.key, one.body.key) // jamais réécrit : le fichier est gardé en cache un an
    const src = await up('role=source', mp4(8.5), 'video/mp4')
    assert.equal(src.body.secs, 8.5)
    assert.match(src.body.key, /^templates\/pub\/[a-z0-9]{12}\.mp4$/)
    assert.equal(t.objects.get(src.body.key).type, 'video/mp4')
    assert.equal(t.rows("SELECT * FROM template_events WHERE action = 'upload'").length, 3)
  } finally { t.restore() }
})

test('forme publique : entrées des lignes (fichier fixe en adresse, sans clé) ou de l’ancienne forme ; aperçu publié ou non', async () => {
  const t = setup()
  try {
    insert(t, 'ancien', { image: 'Le plat sur une table', photo: 'Une photo de votre plat', sort: 0 })
    insert(t, 'neuf', { model: 'kling-3-pro', plans: '[{"text":"@Element1 entre","dur":5}]', sort: 1, published: 0 })
    const add = t.db.raw.prepare('INSERT INTO template_inputs (template_id, idx, slot, kind, mode, file_key, label, optional, prompt, from_idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    add.run('neuf', 0, 'source', 'image', 'user', null, 'Votre visage', 0, null, null)
    add.run('neuf', 1, 'start', 'image', 'generated', null, null, 0, 'Portrait au marché', 0)
    add.run('neuf', 2, 'element', 'image', 'fixed', 'templates/neuf/pagne.png', null, 0, null, null)
    add.run('neuf', 3, 'element', 'video', 'user', null, 'Votre danse', 1, null, null)
    const list = (await t.public('/templates')).body.templates
    assert.deepEqual(list.map((x) => x.id), ['ancien'])
    assert.deepEqual(list[0].inputs, [
      { idx: 0, slot: 'source', kind: 'image', mode: 'user', label: 'Une photo de votre plat', optional: false },
      { idx: 1, slot: 'start', kind: 'image', mode: 'generated', prompt: 'Le plat sur une table', from: 0 },
    ])
    assert.deepEqual([list[0].image, list[0].photo], ['Le plat sur une table', 'Une photo de votre plat'])

    assert.equal((await t.as('user_alice', '/admin/templates/neuf/preview')).status, 403)
    const p = (await t.admin('/admin/templates/neuf/preview')).body.template
    assert.deepEqual(p.inputs, [
      { idx: 0, slot: 'source', kind: 'image', mode: 'user', label: 'Votre visage', optional: false },
      { idx: 1, slot: 'start', kind: 'image', mode: 'generated', prompt: 'Portrait au marché', from: 0 },
      { idx: 2, slot: 'element', kind: 'image', mode: 'fixed', url: 'http://api/files/templates/neuf/pagne.png' },
      { idx: 3, slot: 'element', kind: 'video', mode: 'user', label: 'Votre danse', optional: true },
    ])
    assert.deepEqual([p.image, p.photo, p.modelId, p.video], ['Portrait au marché', 'Votre visage', 'kling-3-pro', 'http://api/files/templates/neuf/video.mp4'])
    t.db.raw.prepare("UPDATE templates SET published = 1 WHERE id = 'neuf'").run()
    const pub = (await t.public('/templates')).body.templates.find((x) => x.id === 'neuf')
    assert.deepEqual(pub, p)
    assert.equal(pub.inputs.some((i) => 'file' in i), false) // la clé R2 n'est jamais envoyée
    // Admin : l'ancienne forme se lit en entrées, sans problème.
    const old = (await t.admin('/admin/templates/ancien')).body.template
    assert.deepEqual(old.inputs.map((i) => i.slot), ['source', 'start'])
    assert.deepEqual(old.issues, [])
  } finally { t.restore() }
})

test('POST /jobs avec un modèle vidéo : fichiers fixes du serveur (sûrs), entrées de l’application, le reste ignoré', async () => {
  const t = setup()
  try {
    insert(t, 'marche')
    const add = t.db.raw.prepare('INSERT INTO template_inputs (template_id, idx, slot, kind, mode, file_key, label, optional) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    add.run('marche', 0, 'reference', 'image', 'fixed', 'templates/marche/decor.png', null, 0)
    add.run('marche', 1, 'reference', 'image', 'user', null, 'Votre produit', 0)
    add.run('marche', 2, 'reference', 'audio', 'user', null, 'Votre musique', 1)
    const job = { kind: 'video', modelId: 'seedance-2-5', template: 'marche', plans: [{ text: '@Image2 posé sur @Image1', dur: 5 }], secs: 5, resolution: '480p', ratio: 'auto', sound: true }
    const send = (body, who = 'user_alice') => t.as(who, '/jobs', json('POST', { ...job, ...body }))
    assert.deepEqual((await send({ templateInputs: [] })).body, { error: 'template_input_missing', idx: 1 })
    assert.equal((await send({ modelId: 'kling-3-pro', templateInputs: [{ idx: 1, url: F(1) }] })).body.error, 'template_model_mismatch')
    assert.equal((await send({ template: 'inconnu' })).body.error, 'unknown_template')
    assert.equal((await send({ templateInputs: [{ idx: 1, url: 'https://ailleurs.example/x.png' }] })).body.error, 'invalid_references') // contrôle habituel
    const ok = await send({
      templateInputs: [{ idx: 1, url: F(1) }], requestId: 'modele-0001',
      references: [{ kind: 'image', url: F(9) }], startImageUrl: F(8), elements: [{ kind: 'image', url: F(7) }], task: 'editing', // ignorés : le modèle fait foi
    })
    assert.equal(ok.status, 202, JSON.stringify(ok.body))
    assert.equal(t.sent.length, 1)
    assert.deepEqual(t.sent[0].body.inputs, { referenceImages: ['http://api/files/templates/marche/decor.png', F(1)] })
    assert.equal(t.sent[0].body.positivePrompt, '@Image2 posé sur @Image1')
    // Facultative fournie : envoyée aussi.
    await send({ templateInputs: [{ idx: 1, url: F(1) }, { idx: 2, url: 'https://v3b.fal.media/files/b/x/m.mp3' }], requestId: 'modele-0002' })
    assert.deepEqual(t.sent[1].body.inputs.referenceAudios, ['https://v3b.fal.media/files/b/x/m.mp3'])
    const params = JSON.parse(t.rows('SELECT params FROM jobs ORDER BY created_at LIMIT 1')[0]?.params ?? '{}')
    assert.equal(params.template, 'marche')
  } finally { t.restore() }
})

test('ancienne forme photo seule (image NULL) : la photo reste l’image de début à fournir (liste, administration, POST /jobs)', async () => {
  const t = setup()
  try {
    insert(t, 'produit', { model: 'kling-3-pro', plans: '[{"text":"Le produit tourne","dur":5}]', photo: 'Une photo de votre produit' })
    const start = { idx: 0, slot: 'start', kind: 'image', mode: 'user', label: 'Une photo de votre produit', optional: false }
    const pub = (await t.public('/templates')).body.templates[0]
    assert.deepEqual(pub.inputs, [start])
    assert.deepEqual([pub.image, pub.photo], [null, 'Une photo de votre produit']) // anciennes applications : inchangé
    const adm = (await t.admin('/admin/templates/produit')).body.template
    assert.deepEqual(adm.inputs, [start]) // l'éditeur renvoie cette entrée : l'exigence n'est pas effacée au premier enregistrement
    assert.deepEqual(adm.issues, [])
    const job = { kind: 'video', modelId: 'kling-3-pro', template: 'produit', plans: [{ text: 'Le produit tourne', dur: 5 }], secs: 5, sound: true }
    assert.deepEqual((await t.as('user_alice', '/jobs', json('POST', { ...job, templateInputs: [] }))).body, { error: 'template_input_missing', idx: 0 })
    const ok = await t.as('user_alice', '/jobs', json('POST', { ...job, templateInputs: [{ idx: 0, url: F(1) }], requestId: 'photo-seule-01' }))
    assert.equal(ok.status, 202, JSON.stringify(ok.body))
    assert.deepEqual(t.sent[0].body.inputs, { frameImages: [{ image: F(1), frame: 'first' }] })
  } finally { t.restore() }
})

test('POST /jobs : modèle non publié lancé par un administrateur seulement ; image créée obligatoire ; Kling 3 éléments', async () => {
  const t = setup()
  try {
    insert(t, 'brouillon', { model: 'kling-3-pro', plans: '[{"text":"@Element1 danse","dur":5}]', published: 0 })
    const add = t.db.raw.prepare('INSERT INTO template_inputs (template_id, idx, slot, kind, mode, file_key, label, optional, prompt, from_idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    add.run('brouillon', 0, 'source', 'image', 'user', null, 'Votre visage', 0, null, null)
    add.run('brouillon', 1, 'start', 'image', 'generated', null, null, 0, 'Portrait', 0)
    add.run('brouillon', 2, 'element', 'image', 'fixed', 'templates/brouillon/pagne.png', null, 0, null, null)
    const job = { kind: 'video', modelId: 'kling-3-pro', template: 'brouillon', plans: [{ text: '@Element1 danse', dur: 5 }], secs: 5, sound: true }
    assert.equal((await t.as('user_alice', '/jobs', json('POST', { ...job, templateInputs: [{ idx: 1, url: F(1) }] }))).body.error, 'unknown_template')
    assert.deepEqual((await t.admin('/jobs', json('POST', { ...job, templateInputs: [{ idx: 0, url: F(0) }] }))).body, { error: 'template_input_missing', idx: 1 })
    const ok = await t.admin('/jobs', json('POST', { ...job, templateInputs: [{ idx: 0, url: F(0) }, { idx: 1, url: F(1) }] }))
    assert.equal(ok.status, 202, JSON.stringify(ok.body))
    assert.deepEqual(t.sent[0].body.inputs, {
      frameImages: [{ image: F(1), frame: 'first' }],
      elements: [{ id: 'element_1', description: 'Élément 1', frontalImage: 'http://api/files/templates/brouillon/pagne.png', images: ['http://api/files/templates/brouillon/pagne.png'] }],
    })
    // Sans modèle : un fichier hors de fal reste refusé (la confiance ne vaut que pour les fichiers du modèle).
    const plain = await t.admin('/jobs', json('POST', { ...job, template: undefined, startImageUrl: 'http://api/files/templates/brouillon/pagne.png' }))
    assert.equal(plain.body.error, 'invalid_file_url')
  } finally { t.restore() }
})

test('POST /jobs Genjutsu : un modèle non publié se lance pour un administrateur, pas pour un utilisateur', async () => {
  const t = setup()
  try {
    insert(t, 'duo', { model: 'motion-transfer', plans: '[]', published: 0 })
    t.db.raw.prepare("INSERT INTO template_genjutsu (template_id, tool, source_key, secs, prompt, roles) VALUES ('duo', 'motion-transfer', 'templates/duo/source.mp4', 8.4, 'A = gauche', '[\"A\",\"B\"]')").run()
    const body = { kind: 'tool', modelId: 'motion-transfer', template: 'duo', inputs: { images: [F(1), F(2)], resolution: '480p' } }
    assert.equal((await t.as('user_alice', '/jobs', json('POST', body))).body.error, 'unknown_template')
    const ok = await t.admin('/jobs', json('POST', body))
    assert.equal(ok.status, 202, JSON.stringify(ok.body))
    assert.equal(t.sent[0].body.video_url, 'http://api/files/templates/duo/source.mp4')
    // Une source sans durée (brouillon) ne se lance pas.
    t.db.raw.prepare("UPDATE template_genjutsu SET secs = 0").run()
    assert.equal((await t.admin('/jobs', json('POST', body))).body.error, 'unknown_template')
  } finally { t.restore() }
})

test('publication : plans vides et durées hors des règles du modèle signalés ; brouillon enregistré quand même', async () => {
  const t = setup()
  try {
    const { id } = (await t.admin('/admin/templates', json('POST', { name: 'Durées' }))).body.template
    const videoKey = `templates/${id}/v.mp4`
    t.objects.set(videoKey, { buf: new ArrayBuffer(1), type: 'video/mp4' })
    t.objects.set('templates/x/decor.png', { buf: new ArrayBuffer(1), type: 'image/png' })
    const save = async (over) => { const r = await t.admin(`/admin/templates/${id}`, json('PUT', seedance({ videoKey, ...over }))); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.template.issues.map((i) => i.code) }
    assert.deepEqual(await save({ plans: [{ text: '   ', dur: 5 }] }), ['empty_plan'])
    assert.deepEqual(await save({ plans: [{ text: 'a', dur: 3 }] }), ['bad_duration']) // Seedance : 4 s au moins
    assert.deepEqual(await save({ plans: [{ text: 'a', dur: 5.5 }] }), ['bad_duration']) // secondes entières
    const kling = { modelId: 'kling-3-pro', resolution: null, ratio: null, inputs: [{ idx: 0, slot: 'start', kind: 'image', mode: 'user', label: 'Votre photo' }] }
    assert.deepEqual(await save({ ...kling, plans: [{ text: 'a', dur: 10 }, { text: 'b', dur: 10 }] }), ['bad_duration']) // somme > 15 s
    assert.deepEqual(await save({ ...kling, plans: [{ text: 'a', dur: 2 }, { text: 'b', dur: 5 }] }), ['bad_duration']) // un plan trop court
    assert.deepEqual(await save({ ...kling, plans: [{ text: 'a', dur: 5 }, { text: 'b', dur: 5 }] }), [])
    await save({ plans: [{ text: '', dur: 5 }] })
    const r = await t.admin(`/admin/templates/${id}/publish`, json('POST', { published: true }))
    assert.equal(r.status, 422)
    assert.deepEqual(r.body.issues, [{ code: 'empty_plan' }])
  } finally { t.restore() }
})

test('publication : fichiers absents de R2 ou de la mauvaise sorte refusés (publication et enregistrement d’un publié), pas pour un brouillon', async () => {
  const t = setup()
  try {
    const { id } = (await t.admin('/admin/templates', json('POST', { name: 'Fichiers' }))).body.template
    const videoKey = `templates/${id}/v.mp4`
    const body = seedance({ videoKey })
    const draft = await t.admin(`/admin/templates/${id}`, json('PUT', body))
    assert.deepEqual(draft.body.template.issues, []) // brouillon : R2 n'est pas consulté
    const publish = () => t.admin(`/admin/templates/${id}/publish`, json('POST', { published: true }))
    const no = await publish()
    assert.equal(no.status, 422)
    assert.deepEqual(no.body.issues, [{ code: 'missing_file', key: videoKey }, { code: 'missing_file', key: 'templates/x/decor.png', idx: 0 }])
    t.objects.set(videoKey, { buf: new ArrayBuffer(1), type: 'video/mp4' })
    t.objects.set('templates/x/decor.png', { buf: new ArrayBuffer(1), type: 'audio/mpeg' })
    assert.deepEqual((await publish()).body.issues, [{ code: 'kind_mismatch', key: 'templates/x/decor.png', kind: 'image', idx: 0 }])
    t.objects.set('templates/x/decor.png', { buf: new ArrayBuffer(1), type: 'image/png' })
    assert.equal((await publish()).status, 200)
    // Publié : un fichier fixe absent refuse l'enregistrement.
    const bad = await t.admin(`/admin/templates/${id}`, json('PUT', seedance({ videoKey, inputs: [{ ...body.inputs[0], file: `templates/${id}/absent.png` }, body.inputs[1]] })))
    assert.equal(bad.status, 422)
    assert.deepEqual(bad.body.issues, [{ code: 'missing_file', key: `templates/${id}/absent.png`, idx: 0 }])
    // Genjutsu publié : la source doit exister.
    const g = { tool: 'motion-transfer', sourceKey: `templates/${id}/source.mp4`, secs: 8, prompt: 'p', roles: ['A'] }
    const gj = await t.admin(`/admin/templates/${id}`, json('PUT', { name: 'Fichiers', category: 'pub', videoKey, sound: true, genjutsu: g }))
    assert.deepEqual(gj.body.issues, [{ code: 'missing_file', key: g.sourceKey }])
  } finally { t.restore() }
})

test('publication concurrente : relue après l’écriture, une version à problèmes n’est jamais publiée', async () => {
  const t = setup()
  try {
    const { id } = (await t.admin('/admin/templates', json('POST', { name: 'Course' }))).body.template
    const videoKey = `templates/${id}/v.mp4`
    t.objects.set(videoKey, { buf: new ArrayBuffer(1), type: 'video/mp4' })
    t.objects.set('templates/x/decor.png', { buf: new ArrayBuffer(1), type: 'image/png' })
    // Un autre administrateur publie pendant l'enregistrement d'une version à problèmes (vue non publiée) : elle est retirée.
    const batch = t.db.batch
    t.db.batch = async (stmts) => { t.db.raw.prepare('UPDATE templates SET published = 1 WHERE id = ?').run(id); t.db.batch = batch; return batch(stmts) }
    const r = await t.admin(`/admin/templates/${id}`, json('PUT', seedance({ videoKey, plans: [{ text: '', dur: 5 }] })))
    assert.equal(r.status, 200)
    assert.equal(r.body.template.published, false)
    assert.equal(t.rows('SELECT published FROM templates WHERE id = ?', id)[0].published, 0)
    // Une version à problèmes enregistrée entre le contrôle et l'écriture de la publication : publication annulée (422).
    await t.admin(`/admin/templates/${id}`, json('PUT', seedance({ videoKey })))
    const prepare = t.db.prepare
    t.db.prepare = (sql) => {
      if (sql.startsWith('UPDATE templates SET published = ?2')) { t.db.raw.prepare(`UPDATE templates SET plans = '[{"text":"","dur":5}]' WHERE id = ?`).run(id); t.db.prepare = prepare }
      return prepare(sql)
    }
    const p = await t.admin(`/admin/templates/${id}/publish`, json('POST', { published: true }))
    assert.equal(p.status, 422)
    assert.deepEqual(p.body.issues, [{ code: 'empty_plan' }])
    assert.equal(t.rows('SELECT published FROM templates WHERE id = ?', id)[0].published, 0)
  } finally { t.restore() }
})

test('publication concurrente : un fichier absent enregistré entre-temps est revérifié après l’écriture', async () => {
  const t = setup()
  try {
    const { id } = (await t.admin('/admin/templates', json('POST', { name: 'Course fichier' }))).body.template
    const videoKey = `templates/${id}/v.mp4`
    t.objects.set(videoKey, { buf: new ArrayBuffer(1), type: 'video/mp4' })
    t.objects.set('templates/x/decor.png', { buf: new ArrayBuffer(1), type: 'image/png' })
    await t.admin(`/admin/templates/${id}`, json('PUT', seedance({ videoKey })))
    // Publication : le brouillon est valide au contrôle, puis une version citant un fichier absent est enregistrée avant l'écriture.
    const prepare = t.db.prepare
    t.db.prepare = (sql) => {
      if (sql.startsWith('UPDATE templates SET published = ?2')) {
        t.db.raw.prepare("UPDATE template_inputs SET file_key = 'templates/x/absent.png' WHERE template_id = ? AND idx = 0").run(id)
        t.db.prepare = prepare
      }
      return prepare(sql)
    }
    const p = await t.admin(`/admin/templates/${id}/publish`, json('POST', { published: true }))
    assert.equal(p.status, 422)
    assert.deepEqual(p.body.issues, [{ code: 'missing_file', key: 'templates/x/absent.png', idx: 0 }])
    assert.equal(t.rows('SELECT published FROM templates WHERE id = ?', id)[0].published, 0)
    // Enregistrement vu non publié, publié entre-temps : la version qui cite un fichier absent est retirée.
    const body = seedance({ videoKey })
    const batch = t.db.batch
    t.db.batch = async (stmts) => { t.db.raw.prepare('UPDATE templates SET published = 1 WHERE id = ?').run(id); t.db.batch = batch; return batch(stmts) }
    const r = await t.admin(`/admin/templates/${id}`, json('PUT', seedance({ videoKey, inputs: [{ ...body.inputs[0], file: 'templates/x/absent.png' }, body.inputs[1]] })))
    assert.equal(r.status, 200)
    assert.equal(r.body.template.published, false)
    assert.equal(t.rows('SELECT published FROM templates WHERE id = ?', id)[0].published, 0)
  } finally { t.restore() }
})

test('enregistrement et ordre atomiques : une requête refusée ne laisse rien à moitié écrit', async () => {
  const t = setup()
  try {
    const { id } = (await t.admin('/admin/templates', json('POST', { name: 'Atome' }))).body.template
    await t.admin(`/admin/templates/${id}`, json('PUT', seedance()))
    const before = t.rows('SELECT * FROM template_inputs').map((r) => ({ ...r }))
    t.db.failAt = 3 // la dernière requête (source Genjutsu), après la mise à jour et les entrées
    const r = await t.admin(`/admin/templates/${id}`, json('PUT', seedance({ name: 'Autre nom', inputs: [seedance().inputs[1]] })))
    assert.ok(r.status >= 500)
    assert.deepEqual(t.rows('SELECT * FROM template_inputs').map((x) => ({ ...x })), before)
    assert.equal(t.rows('SELECT name FROM templates')[0].name, 'Pub du marché')
    insert(t, 'b', { sort: 5 })
    t.db.failAt = 1
    assert.ok((await t.admin('/admin/templates/order', json('POST', { ids: ['b', id] }))).status >= 500)
    assert.deepEqual(t.rows('SELECT id FROM templates ORDER BY sort').map((x) => x.id), [id, 'b'])
    t.db.failAt = null
  } finally { t.restore() }
})

test('suppression : refusée si un autre modèle cite un fichier du dossier ; R2 d’abord, pour qu’un nouvel essai retrouve le modèle', async () => {
  const t = setup()
  try {
    insert(t, 'a'); insert(t, 'b'); insert(t, 'c', { video: 'templates/a/video.mp4' })
    t.db.raw.prepare("INSERT INTO template_inputs (template_id, idx, slot, kind, mode, file_key) VALUES ('b', 0, 'reference', 'image', 'fixed', 'templates/a/decor.png')").run()
    for (const k of ['templates/a/video.mp4', 'templates/a/decor.png', 'templates/b/video.mp4']) t.objects.set(k, { buf: new ArrayBuffer(1) })
    const r = await t.admin('/admin/templates/a', { method: 'DELETE' })
    assert.equal(r.status, 409)
    assert.deepEqual(r.body, { error: 'files_in_use', templates: ['b', 'c'] })
    assert.equal(t.objects.size, 3)
    t.db.raw.prepare("DELETE FROM templates WHERE id = 'c'").run()
    t.db.raw.prepare("DELETE FROM template_inputs WHERE template_id = 'b'").run()
    // Panne de R2 au milieu : le modèle reste, le nouvel essai finit le travail.
    const del = t.bucket.delete
    let n = 0
    t.bucket.delete = async (k) => { if (n++ === 1) throw new Error('R2 indisponible'); return del(k) }
    assert.ok((await t.admin('/admin/templates/a', { method: 'DELETE' })).status >= 500)
    assert.equal(t.rows("SELECT * FROM templates WHERE id = 'a'").length, 1)
    t.bucket.delete = del
    assert.deepEqual((await t.admin('/admin/templates/a', { method: 'DELETE' })).body, { ok: true })
    assert.deepEqual([...t.objects.keys()], ['templates/b/video.mp4'])
    assert.equal(t.rows("SELECT * FROM templates WHERE id = 'a'").length, 0)
  } finally { t.restore() }
})

test('dépôt : contenu contrôlé par ses premiers octets (415) ; modèle supprimé pendant le dépôt → fichier effacé, 404', async () => {
  const t = setup()
  try {
    insert(t, 'pub')
    const up = (q, body, type) => t.admin(`/admin/templates/pub/files?${q}`, { method: 'POST', headers: { 'content-type': type, 'content-length': String(body.length) }, body, duplex: 'half' })
    const pad = (...b) => bytes(b, new Array(16).fill(0))
    const riff = (tag) => pad(...ascii('RIFF'), 0, 0, 0, 0, ...ascii(tag))
    const good = {
      'image/png': pad(137, 80, 78, 71, 13, 10, 26, 10), 'image/jpeg': pad(0xff, 0xd8, 0xff, 0xe0), 'image/webp': riff('WEBP'),
      'video/mp4': mp4(2), 'video/webm': pad(0x1a, 0x45, 0xdf, 0xa3), 'audio/mpeg': pad(...ascii('ID3')), 'audio/wav': riff('WAVE'), 'audio/x-wav': riff('WAVE'),
      'audio/ogg': pad(...ascii('OggS')), 'audio/mp4': pad(0, 0, 0, 24, ...ascii('ftypM4A ')),
    }
    for (const [type, body] of Object.entries(good)) assert.equal((await up('role=input', body, type)).status, 201, type)
    assert.equal((await up('role=input', pad(0xff, 0xfb, 0x90), 'audio/mpeg')).status, 201) // MP3 sans ID3 : synchronisation de trame
    assert.equal((await up('role=video', pad(0, 0, 0, 8, ...ascii('moov')), 'video/quicktime')).status, 201)
    const count = t.objects.size
    for (const [type, body] of [['image/png', good['image/jpeg']], ['image/jpeg', good['image/png']], ['image/webp', good['audio/wav']], ['video/mp4', good['video/webm']],
      ['audio/mpeg', good['audio/ogg']], ['audio/wav', good['image/webp']], ['audio/ogg', good['image/png']], ['video/webm', good['video/mp4']]]) {
      const r = await up(type.startsWith('video/') ? 'role=video' : 'role=input', body, type)
      assert.deepEqual([r.status, r.body.error], [415, 'unsupported_type'], type)
    }
    assert.equal(t.objects.size, count)
    // Gros dépôt (en flux) : relu dans R2 après l'écriture, effacé s'il ne correspond pas.
    const big = new Uint8Array(26 * 1024 * 1024)
    assert.equal((await up('role=source', big, 'video/mp4')).status, 415)
    assert.equal(t.objects.size, count)
    big.set(mp4(2))
    assert.equal((await up('role=source', big, 'video/mp4')).status, 201)
    // Suppression du modèle pendant l'écriture : rien ne lui survit.
    const put = t.bucket.put
    t.bucket.put = async (...args) => { t.db.raw.prepare("DELETE FROM templates WHERE id = 'pub'").run(); return put(...args) }
    const size = t.objects.size
    assert.equal((await up('role=input', good['image/png'], 'image/png')).status, 404)
    assert.equal(t.objects.size, size)
  } finally { t.restore() }
})

test('forme publique : sans image de début créée, `photo` vient de l’image de début obligatoire à fournir (anciennes applications)', async () => {
  const t = setup()
  try {
    insert(t, 'photo', { model: 'kling-3-pro' })
    insert(t, 'facultatif', { model: 'kling-4', sort: 1 })
    const add = t.db.raw.prepare('INSERT INTO template_inputs (template_id, idx, slot, kind, mode, label, optional) VALUES (?, ?, ?, ?, ?, ?, ?)')
    add.run('photo', 0, 'start', 'image', 'user', 'Votre portrait', 0)
    add.run('facultatif', 0, 'start', 'image', 'user', 'Votre portrait', 1)
    const list = (await t.public('/templates')).body.templates
    assert.deepEqual(list.map((x) => [x.id, x.image, x.photo]), [['photo', null, 'Votre portrait'], ['facultatif', null, null]])
  } finally { t.restore() }
})

test('POST /jobs : une entrée facultative omise ne décale pas les jetons des suivantes (la première omise est demandée)', async () => {
  const t = setup()
  try {
    insert(t, 'danse', { model: 'kling-3-pro', plans: '[{"text":"@Element1 et @Element2 dansent","dur":5}]' })
    const add = t.db.raw.prepare('INSERT INTO template_inputs (template_id, idx, slot, kind, mode, file_key, label, optional) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    add.run('danse', 0, 'start', 'image', 'user', null, 'Votre photo', 0)
    add.run('danse', 1, 'element', 'image', 'user', null, 'Premier danseur', 1)
    add.run('danse', 2, 'element', 'image', 'user', null, 'Second danseur', 1)
    const job = { kind: 'video', modelId: 'kling-3-pro', template: 'danse', plans: [{ text: '@Element1 et @Element2 dansent', dur: 5 }], secs: 5, sound: true }
    const send = (templateInputs, requestId) => t.as('user_alice', '/jobs', json('POST', { ...job, templateInputs, requestId }))
    assert.deepEqual((await send([{ idx: 0, url: F(0) }, { idx: 2, url: F(2) }], 'danse-00001')).body, { error: 'template_input_missing', idx: 1 })
    // Omise mais citée par le texte : refusée avant tout débit (le fournisseur recevrait « @Element2 » sans fichier).
    assert.deepEqual((await send([{ idx: 0, url: F(0) }, { idx: 1, url: F(1) }], 'danse-00002')).body, { error: 'template_input_missing', idx: 2 })
    assert.equal(t.sent.length, 0)
    const ok = await t.as('user_alice', '/jobs', json('POST', { ...job, plans: [{ text: '@Element1 danse', dur: 5 }], templateInputs: [{ idx: 0, url: F(0) }, { idx: 1, url: F(1) }], requestId: 'danse-00003' }))
    assert.equal(ok.status, 202, JSON.stringify(ok.body))
    assert.deepEqual(t.sent[0].body.inputs.elements.map((e) => [e.id, e.frontalImage]), [['element_1', F(1)]])
    assert.doesNotMatch(t.sent[0].body.inputs.prompt ?? JSON.stringify(t.sent[0].body.inputs), /element_2/)
  } finally { t.restore() }
})
