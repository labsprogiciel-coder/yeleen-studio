import { Hono } from 'hono'
import { VIDEO_MODELS } from '@studio/catalog'
import { LIMITS, findVideoModel, inputIssues } from '@studio/catalog/template-slots'
import { INPUT_COLS, TEMPLATE_COLS, inputRows, inputsOf, publicTemplate, templateRow } from './library.js'
import { mediaInfo } from './media.js'
import { templateKey } from './storage.js'

/**
 * Administration des vidéos à refaire (Modèles, `/admin/templates`) : créer, modifier, publier ou retirer, réordonner, supprimer un
 * modèle, déposer ses fichiers dans R2 (sous `templates/<id>/`), et le voir comme l'application avant de le publier. Montée par
 * admin.js : la garde `/admin/*` d'index.js s'applique (comptes de ADMIN_USER_IDS). D1 seule fait foi : chaque changement est noté
 * dans `template_events` (qui, quand, quoi).
 *
 * Un modèle du générateur de vidéos a des entrées (`template_inputs`, voir templateSlots.js) ; un modèle Genjutsu a une source
 * (`template_genjutsu`) et ses rôles. Un brouillon peut être incomplet (ses problèmes sont rendus dans `issues`) ; un modèle publié
 * ne peut l'être : son enregistrement est refusé (422), et la publication exige zéro problème.
 */
const TOOLS = ['motion-transfer', 'object-swap']
// Problèmes qui rendent les entrées inutilisables : refusés même pour un brouillon. Les autres (capacités du modèle) sont montrés.
const STRUCTURAL = ['bad_inputs', 'bad_idx', 'bad_input', 'bad_kind', 'too_many_inputs']
const ID = /^[\w-]{1,80}$/
const CATEGORY = /^[a-z0-9-]{1,30}$/
const RATIO = /^(auto|\d{1,2}:\d{1,2})$/
const MB = 1024 * 1024
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const TYPES = {
  video: VIDEO_TYPES, source: VIDEO_TYPES,
  input: ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg'],
}
/** Taille maximale d'un fichier déposé : l'aperçu (rôle `video`) doit déjà être léger ; une source ou une vidéo d'entrée, 100 Mo. */
export const maxUpload = (role, type) => (type.startsWith('image/') ? 10 * MB : type.startsWith('audio/') ? 15 * MB : role === 'video' ? 20 * MB : 100 * MB)
const STREAM_FROM = 25 * MB // au-delà, le corps va à R2 en flux, sans être chargé en mémoire (et la durée n'est pas mesurée)

const oneLine = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : null)
const isKey = (v) => typeof v === 'string' && v.startsWith('templates/') && !v.includes('..') && v.length <= 300
const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
/** Identifiant d'un nouveau modèle : son nom sans accents (a-z, 0-9, tirets, 40 caractères au plus) et 4 caractères aléatoires. */
export const slug = (name) => `${String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'modele'}-${rand(4)}`
const parse = (v) => { try { return JSON.parse(v) } catch { return null } }

/** Plans illisibles pour ce modèle : 1 à 4 plans { text, dur > 0 }, plusieurs seulement s'il sait enchaîner des plans. */
const badPlans = (plans, model) => !Array.isArray(plans) || !plans.length || plans.length > 4 || (plans.length > 1 && !model?.caps?.multiShot)
  || plans.some((p) => typeof p?.text !== 'string' || p.text.length > 2000 || !(typeof p.dur === 'number' && Number.isFinite(p.dur) && p.dur > 0))
/** Source Genjutsu inutilisable : outil, vidéo source, durée (4 à 20 s), consigne et rôles (1 à 8). */
const genjutsuIncomplete = (g) => !TOOLS.includes(g.tool) || !isKey(g.sourceKey) || !(g.secs >= 4 && g.secs <= 20) || typeof g.prompt !== 'string' || !g.prompt.trim()
  || g.prompt.length > 10000 || !Array.isArray(g.roles) || !g.roles.length || g.roles.length > 8 || g.roles.some((r) => typeof r !== 'string' || !r.trim() || r.length > 120)

/** Problèmes d'un modèle (enregistré ou à enregistrer) : [] s'il peut être publié. */
export function templateIssues({ videoKey, modelId, plans, inputs, genjutsu }) {
  const out = videoKey ? [] : [{ code: 'no_video' }]
  if (genjutsu) return genjutsuIncomplete(genjutsu) ? [...out, { code: 'genjutsu_incomplete' }] : out
  const model = findVideoModel(modelId)
  if (!model) out.push({ code: 'model_removed' })
  else out.push(...inputIssues(model, inputs))
  if (badPlans(plans, model)) out.push({ code: 'bad_plans' })
  return out
}

/** Un modèle tel que l'administration le reçoit (toutes les données, adresses des fichiers comprises, et ses problèmes). */
export function adminView(t, rows, origin) {
  const url = (key) => (key ? `${origin}/files/${key}` : null)
  const genjutsu = t.g_tool ? { tool: t.g_tool, sourceKey: t.g_source_key, source: url(t.g_source_key), secs: t.g_secs, prompt: t.g_prompt, roles: parse(t.g_roles) } : null
  const plans = genjutsu ? [] : parse(t.plans)
  const inputs = genjutsu ? [] : inputsOf(t, rows)
  return {
    id: t.id, name: t.name, blurb: t.blurb ?? null, category: t.category, videoKey: t.video_key, video: url(t.video_key), modelId: t.model_id,
    plans: Array.isArray(plans) ? plans : [], resolution: t.resolution ?? null, ratio: t.ratio ?? null, sound: Boolean(t.sound), sort: t.sort,
    published: Boolean(t.published), createdAt: t.created_at,
    inputs: inputs.map((i) => ({ ...i, ...(i.mode === 'fixed' && i.file ? { url: url(i.file) } : {}) })), genjutsu,
    issues: templateIssues({ videoKey: t.video_key, modelId: t.model_id, plans, inputs, genjutsu }),
  }
}

/**
 * Corps de PUT /admin/templates/:id, contrôlé et ramené à ce qui est enregistré : { data } ou { bad } (problèmes qui refusent
 * l'enregistrement même d'un brouillon : champ illisible, entrées inutilisables).
 */
export function readTemplate(b) {
  const bad = []
  const field = (f, extra = {}) => bad.push({ code: 'invalid_field', field: f, ...extra })
  const name = oneLine(b.name)
  if (!name || name.length > 80) field('name')
  const blurb = b.blurb == null ? null : oneLine(b.blurb) || null
  if ((b.blurb != null && typeof b.blurb !== 'string') || (blurb && blurb.length > 160)) field('blurb')
  if (typeof b.category !== 'string' || !CATEGORY.test(b.category)) field('category')
  const videoKey = b.videoKey ?? ''
  if (videoKey !== '' && !isKey(videoKey)) field('videoKey')
  if (typeof b.sound !== 'boolean') field('sound')
  const base = { name, blurb, category: b.category, videoKey, sound: b.sound === true }

  if (b.genjutsu != null) {
    const g = b.genjutsu
    if (typeof g !== 'object') { field('genjutsu'); return { bad } }
    if (!TOOLS.includes(g.tool)) field('genjutsu.tool')
    const sourceKey = g.sourceKey ?? ''
    if (sourceKey !== '' && !isKey(sourceKey)) field('genjutsu.sourceKey')
    const secs = g.secs ?? 0
    if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0 || secs > 20) field('genjutsu.secs')
    const prompt = g.prompt ?? ''
    if (typeof prompt !== 'string' || prompt.length > 10000) field('genjutsu.prompt')
    const roles = Array.isArray(g.roles) ? g.roles.map(oneLine) : null
    if (!roles || roles.length > 8 || roles.some((r) => r == null || r.length > 120)) field('genjutsu.roles')
    if (b.ratio != null && (typeof b.ratio !== 'string' || !RATIO.test(b.ratio))) field('ratio')
    if (bad.length) return { bad }
    return { data: { ...base, modelId: g.tool, plans: [], resolution: null, ratio: b.ratio ?? null, inputs: [], genjutsu: { tool: g.tool, sourceKey, secs, prompt, roles } } }
  }

  const model = findVideoModel(b.modelId)
  if (!model) bad.push({ code: 'unknown_model' })
  if (badPlans(b.plans, model ?? { caps: { multiShot: true } })) bad.push({ code: 'bad_plans' })
  const c = model?.caps ?? {}
  if (model && b.resolution != null && !c.resolutions?.includes(b.resolution)) field('resolution')
  if (model && b.ratio != null && b.ratio !== 'auto' && !c.ratios?.includes(b.ratio)) field('ratio')
  if (!Array.isArray(b.inputs)) { bad.push({ code: 'bad_inputs' }); return { bad } }
  // Contrôle de forme seulement : il ne dépend pas du modèle (d'où un modèle quelconque si celui-ci est inconnu).
  const shape = inputIssues(model ?? VIDEO_MODELS[0], b.inputs).filter((i) => STRUCTURAL.includes(i.code))
  if (shape.length) { bad.push(...shape); return { bad } }
  const inputs = [...b.inputs].sort((x, y) => x.idx - y.idx).map((i) => {
    const at = { idx: i.idx }
    if (i.mode === 'fixed') {
      if (i.file != null && !isKey(i.file)) field('inputs.file', at)
      return { idx: i.idx, slot: i.slot, kind: i.kind, mode: 'fixed', ...(i.file ? { file: i.file } : {}), optional: false }
    }
    if (i.mode === 'user') {
      const label = i.label == null ? '' : oneLine(i.label)
      if (label == null || label.length > LIMITS.label) field('inputs.label', at)
      if (i.optional != null && typeof i.optional !== 'boolean') field('inputs.optional', at)
      return { idx: i.idx, slot: i.slot, kind: i.kind, mode: 'user', ...(label ? { label } : {}), optional: i.optional === true }
    }
    const prompt = i.prompt ?? ''
    if (typeof prompt !== 'string' || prompt.length > LIMITS.prompt) field('inputs.prompt', at)
    if (i.from != null && !Number.isInteger(i.from)) field('inputs.from', at)
    return { idx: i.idx, slot: i.slot, kind: i.kind, mode: 'generated', ...(prompt ? { prompt } : {}), ...(i.from != null ? { from: i.from } : {}), optional: false }
  })
  if (bad.length) return { bad }
  return { data: { ...base, modelId: b.modelId, plans: b.plans.map((p) => ({ text: p.text, dur: p.dur })), resolution: b.resolution ?? null, ratio: b.ratio ?? null, inputs, genjutsu: null } }
}

export function adminTemplatesApp() {
  const a = new Hono()
  a.use('*', async (c, next) => { await next(); c.header('cache-control', 'no-store') }) // jamais gardé en cache : l'éditeur relit l'état réel

  const origin = (c) => new URL(c.req.url).origin
  const body = (c) => c.req.json().then((b) => (b && typeof b === 'object' && !Array.isArray(b) ? b : {}), () => ({}))
  /** Note un changement dans `template_events`. Fait après le changement : une panne de D1 ici est journalisée, rien n'est défait. */
  const log = async (c, templateId, action, detail = null) => {
    try {
      await c.env.DB.prepare('INSERT INTO template_events (id, at, actor, template_id, action, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(crypto.randomUUID(), Date.now(), c.get('uid'), templateId, action, detail == null ? null : JSON.stringify(detail)).run()
    } catch (e) {
      console.error('modèles : journal non écrit (D1)', templateId, action, e.message)
    }
  }
  /** Le modèle `:id` (ligne D1), ou la réponse 404. */
  const load = async (c) => {
    const id = c.req.param('id')
    const t = ID.test(id ?? '') ? await templateRow(c.env.DB, id) : null
    return t ? { t } : { error: c.json({ error: 'not_found' }, 404) }
  }
  const view = async (c, id) => adminView(await templateRow(c.env.DB, id), await inputRows(c.env.DB, id), origin(c))

  // Tous les modèles, publiés ou non, dans l'ordre de la page Modèles.
  a.get('/', async (c) => {
    const db = c.env.DB
    const { results } = await db.prepare(`SELECT ${TEMPLATE_COLS} FROM templates t LEFT JOIN template_genjutsu g ON g.template_id = t.id ORDER BY t.sort, t.created_at`).bind().all()
    const rows = new Map()
    for (const r of (await db.prepare(`SELECT ${INPUT_COLS} FROM template_inputs i ORDER BY i.template_id, i.idx`).bind().all()).results) rows.set(r.template_id, [...(rows.get(r.template_id) ?? []), r])
    return c.json({ templates: results.map((t) => adminView(t, rows.get(t.id) ?? [], origin(c))) })
  })

  // Nouveau brouillon : un nom suffit ; le reste a des valeurs par défaut (Seedance 2.5, un plan vide de 5 s), à la fin de la liste.
  a.post('/', async (c) => {
    const name = oneLine((await body(c)).name)
    if (!name || name.length > 80) return c.json({ error: 'invalid_template', issues: [{ code: 'invalid_field', field: 'name' }] }, 400)
    const db = c.env.DB
    const id = slug(name)
    const { last } = await db.prepare('SELECT MAX(sort) AS last FROM templates').bind().first()
    await db.prepare(`INSERT INTO templates (id, name, blurb, category, video_key, image, model_id, plans, resolution, ratio, sound, photo, sort, published, created_at)
      VALUES (?1, ?2, NULL, 'autres', '', NULL, 'seedance-2-5', '[{"text":"","dur":5}]', NULL, NULL, 1, NULL, ?3, 0, ?4)`).bind(id, name, (last ?? -1) + 1, Date.now()).run()
    await log(c, id, 'create', { name })
    return c.json({ template: await view(c, id) }, 201)
  })

  // Nouvel ordre : la liste complète (ou partielle) des identifiants ; chaque modèle prend sa position.
  a.post('/order', async (c) => {
    const ids = (await body(c)).ids
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some((x) => typeof x !== 'string' || !ID.test(x)) || new Set(ids).size !== ids.length) return c.json({ error: 'invalid_ids' }, 400)
    const db = c.env.DB
    const known = new Set((await db.prepare('SELECT id FROM templates').bind().all()).results.map((r) => r.id))
    const missing = ids.filter((x) => !known.has(x))
    if (missing.length) return c.json({ error: 'unknown_template', ids: missing }, 400)
    for (const [i, x] of ids.entries()) await db.prepare('UPDATE templates SET sort = ?2 WHERE id = ?1').bind(x, i).run()
    await log(c, '*', 'order', { ids })
    return c.json({ ok: true })
  })

  a.get('/:id', async (c) => {
    const { t, error } = await load(c)
    return error ?? c.json({ template: await view(c, t.id) })
  })

  // Tel que l'application le recevra (GET /templates), publié ou non : pour « Essayer sur mon compte » (Cinéma, ?tpl=<id>).
  a.get('/:id/preview', async (c) => {
    const { t, error } = await load(c)
    if (error) return error
    const rows = await inputRows(c.env.DB, t.id)
    const out = publicTemplate(t, rows, origin(c))
    return out ? c.json({ template: out }) : c.json({ error: 'invalid_template', issues: adminView(t, rows, origin(c)).issues }, 422)
  })

  // Enregistrement complet. Les entrées sont remplacées (elles font foi : `image` et `photo` sont vidées) ; passer de l'un à l'autre
  // (générateur ↔ Genjutsu) retire les données de l'autre forme.
  a.put('/:id', async (c) => {
    const { t, error } = await load(c)
    if (error) return error
    const { data, bad } = readTemplate(await body(c))
    if (bad) return c.json({ error: 'invalid_template', issues: bad }, 400)
    const issues = templateIssues(data)
    if (t.published && issues.length) return c.json({ error: 'invalid_template', issues }, 422) // publié : il doit rester utilisable
    const db = c.env.DB
    await db.prepare(`UPDATE templates SET name = ?2, blurb = ?3, category = ?4, video_key = ?5, image = NULL, model_id = ?6, plans = ?7, resolution = ?8, ratio = ?9,
      sound = ?10, photo = NULL WHERE id = ?1`).bind(t.id, data.name, data.blurb, data.category, data.videoKey, data.modelId, JSON.stringify(data.plans),
      data.resolution, data.ratio, data.sound ? 1 : 0).run()
    // Pas de batch() (la base de test n'en a pas) : effacer puis réécrire, dans l'ordre.
    await db.prepare('DELETE FROM template_inputs WHERE template_id = ?1').bind(t.id).run()
    for (const i of data.inputs) {
      await db.prepare('INSERT INTO template_inputs (template_id, idx, slot, kind, mode, file_key, label, optional, prompt, from_idx) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
        .bind(t.id, i.idx, i.slot, i.kind, i.mode, i.file ?? null, i.label ?? null, i.optional ? 1 : 0, i.prompt ?? null, i.from ?? null).run()
    }
    const g = data.genjutsu
    if (g) {
      await db.prepare(`INSERT INTO template_genjutsu (template_id, tool, source_key, secs, prompt, roles) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT (template_id) DO UPDATE SET tool = excluded.tool, source_key = excluded.source_key, secs = excluded.secs, prompt = excluded.prompt, roles = excluded.roles`)
        .bind(t.id, g.tool, g.sourceKey, g.secs, g.prompt, JSON.stringify(g.roles)).run()
    } else await db.prepare('DELETE FROM template_genjutsu WHERE template_id = ?1').bind(t.id).run()
    await log(c, t.id, 'update', { issues: issues.length })
    return c.json({ template: await view(c, t.id) })
  })

  // Publier (zéro problème, une vidéo d'exemple) ou retirer de la page Modèles (toujours permis).
  a.post('/:id/publish', async (c) => {
    const { t, error } = await load(c)
    if (error) return error
    const { published } = await body(c)
    if (typeof published !== 'boolean') return c.json({ error: 'invalid_published' }, 400)
    if (published) {
      const issues = (await view(c, t.id)).issues
      if (issues.length) return c.json({ error: 'invalid_template', issues }, 422)
    }
    await c.env.DB.prepare('UPDATE templates SET published = ?2 WHERE id = ?1').bind(t.id, published ? 1 : 0).run()
    await log(c, t.id, published ? 'publish' : 'unpublish')
    return c.json({ template: await view(c, t.id) })
  })

  // Suppression définitive : lignes D1, puis fichiers R2 du dossier du modèle seulement (une autre clé peut être partagée).
  a.delete('/:id', async (c) => {
    const { t, error } = await load(c)
    if (error) return error
    const db = c.env.DB
    for (const table of ['template_inputs', 'template_genjutsu']) await db.prepare(`DELETE FROM ${table} WHERE template_id = ?1`).bind(t.id).run()
    await db.prepare('DELETE FROM templates WHERE id = ?1').bind(t.id).run()
    const bucket = c.env.FILES
    const keys = []
    if (bucket) {
      // Toute la liste d'abord, puis les suppressions : une page suivante ne dépend pas de ce qui a déjà été effacé.
      const prefix = `templates/${t.id}/`
      let cursor
      do {
        const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) })
        for (const o of page.objects ?? []) if (o.key.startsWith(prefix)) keys.push(o.key)
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
      for (const k of keys) await bucket.delete(k)
    }
    await log(c, t.id, 'delete', { name: t.name, files: keys.length })
    return c.json({ ok: true })
  })

  // Dépôt d'un fichier (corps brut, avec son type et sa longueur) : aperçu (`video`), source Genjutsu (`source`) ou entrée fixe (`input`).
  // Il est écrit tel quel (aucune conversion) sous une clé neuve : remplacer un fichier, c'est en déposer un autre.
  a.post('/:id/files', async (c) => {
    const role = c.req.query('role')
    if (!TYPES[role]) return c.json({ error: 'invalid_role' }, 400)
    const { t, error } = await load(c)
    if (error) return error
    const bucket = c.env.FILES
    if (!bucket) return c.json({ error: 'storage_unavailable' }, 503)
    const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!TYPES[role].includes(type)) return c.json({ error: 'unsupported_type' }, 415)
    const length = Number(c.req.header('content-length') ?? 0)
    if (!length) return c.json({ error: 'length_required' }, 411)
    const max = maxUpload(role, type)
    if (length > max) return c.json({ error: 'too_large', max }, 413)
    const key = templateKey(t.id, rand(12), type)
    const body = length > STREAM_FROM ? c.req.raw.body : await c.req.arrayBuffer()
    const stored = await bucket.put(key, body, { httpMetadata: { contentType: type } })
    const size = stored?.size ?? length
    if (!size || size > max) { await bucket.delete(key); return c.json({ error: size ? 'too_large' : 'empty', ...(size ? { max } : {}) }, size ? 413 : 400) }
    // Source Genjutsu : sa durée fixe le prix ; mesurée ici quand le fichier est en mémoire (MP4, MOV), sinon l'éditeur la demande.
    const secs = role === 'source' && body instanceof ArrayBuffer ? mediaInfo(body, type)?.secs : undefined
    const name = (c.req.query('name') ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)
    await log(c, t.id, 'upload', { role, key, size, contentType: type, ...(name ? { name } : {}) })
    return c.json({ key, url: `${origin(c)}/files/${key}`, size, contentType: type, ...(secs > 0 ? { secs } : {}) }, 201)
  })

  return a
}
