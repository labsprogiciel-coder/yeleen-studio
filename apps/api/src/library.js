import { legacyInputs } from '@studio/catalog/template-slots'

/**
 * Lectures de D1 pour l'application : « Ma bibliothèque » (fichiers générés et importés, gardés dans R2), favoris des deux bibliothèques,
 * et Bibliothèque Yeleen (`catalog_items`), rendue au format de `public/catalog/yeleen.json` pour que le site n'ait qu'une adresse à changer.
 */
const page = (limit, max = 200) => Math.min(Math.max(Number(limit) || 50, 1), max)
const KINDS = ['image', 'video', 'audio']
export const SCOPES = ['mine', 'yeleen']
export const ITEM_ID = /^[\w:.-]{1,120}$/

/** Une ligne `assets` telle que l'application la reçoit ; `url` est l'adresse servie par l'API (`/files/…`). */
export const assetView = (a, origin) => ({
  id: a.id, kind: a.kind, source: a.source, name: a.name, url: `${origin}/files/${a.r2_key}`, contentType: a.content_type, bytes: a.bytes ?? null,
  width: a.width, height: a.height, secs: a.secs, prompt: a.prompt, model: a.model, jobId: a.job_id, index: a.idx, createdAt: a.created_at,
})

/** Fichiers d'un compte, du plus récent au plus ancien. */
export async function listAssets(db, account, { origin, kind, limit, before } = {}) {
  const where = ['user_id = ?1', 'deleted_at IS NULL']
  const args = [account]
  if (KINDS.includes(kind)) { args.push(kind); where.push(`kind = ?${args.length}`) }
  if (before) { args.push(Number(before)); where.push(`created_at < ?${args.length}`) }
  args.push(page(limit))
  const { results } = await db.prepare(`SELECT id, kind, source, name, r2_key, content_type, bytes, width, height, secs, prompt, model, job_id, idx, created_at
    FROM assets WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?${args.length}`).bind(...args).all()
  return results.map((a) => assetView(a, origin))
}

/** Une ligne `assets` du compte (supprimée ou non : voir `deleted_at`), ou null. */
export const getAsset = (db, account, id) =>
  db.prepare('SELECT id, kind, source, name, r2_key, content_type, bytes, width, height, secs, prompt, model, job_id, idx, created_at, deleted_at FROM assets WHERE id = ?1 AND user_id = ?2').bind(id, account).first()

/** Enregistre un fichier importé (déjà écrit dans R2 sous `key`) et rend sa ligne. */
export async function insertUpload(db, account, { id, kind, name, key, contentType, bytes, secs = null, width = null, height = null }, now = Date.now()) {
  const row = { id, user_id: account, kind, source: 'upload', name, r2_key: key, content_type: contentType, bytes, width, height, secs, prompt: null, model: null, job_id: null, idx: null, created_at: now }
  await db.prepare(`INSERT INTO assets (id, user_id, kind, source, name, r2_key, content_type, bytes, width, height, secs, created_at)
    VALUES (?1, ?2, ?3, 'upload', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`).bind(id, account, kind, name, key, contentType, bytes, width, height, secs, now).run()
  return row
}

/** Une ligne non supprimée (de n'importe quel compte, ou celle-ci si un import vient de la refaire) pointe-t-elle sur cette clé R2 ? */
const keyInUse = async (db, key) => Boolean(await db.prepare('SELECT 1 AS n FROM assets WHERE r2_key = ?1 AND deleted_at IS NULL LIMIT 1').bind(key).first())

/**
 * Efface de R2 le fichier d'une ligne supprimée, sauf si une autre ligne encore visible utilise la même clé. Un fichier déjà absent
 * n'est pas une erreur. Rend vrai si le fichier n'est plus dans R2 ; faux s'il y reste (gardé, R2 ou D1 en panne : noté dans le journal,
 * la ligne reste marquée supprimée et une nouvelle demande de suppression réessaie).
 */
export async function purgeFile(db, bucket, row) {
  if (!bucket) return false
  try {
    if (await keyInUse(db, row.r2_key)) return false
    await bucket.delete(row.r2_key)
    return true
  } catch (e) {
    console.error('suppression : fichier resté dans R2', row.id, row.r2_key, e.message)
    return false
  }
}

/**
 * Suppression d'un fichier du compte : la ligne est marquée (`deleted_at`, elle reste pour qu'une copie tardive de la génération ne la
 * recrée pas), ses favoris sont retirés, puis son fichier est effacé de R2 (`bucket`). Vrai si le fichier existait et n'était pas déjà
 * supprimé. Déjà supprimé : faux, mais l'effacement dans R2 est réessayé (il a pu échouer la première fois).
 */
export async function deleteAsset(db, account, id, { bucket, now = Date.now() } = {}) {
  const read = () => db.prepare('SELECT id, r2_key, deleted_at FROM assets WHERE id = ?1 AND user_id = ?2').bind(id, account).first()
  if (!await read()) return false
  const r = await db.prepare('UPDATE assets SET deleted_at = ?3 WHERE id = ?2 AND user_id = ?1 AND deleted_at IS NULL').bind(account, id, now).run()
  const done = (r.meta?.changes ?? 0) > 0
  // La ligne est relue après la marque : un import rejoué a pu lui donner un autre fichier entre-temps, et c'est la clé de la ligne
  // réellement supprimée qu'il faut effacer. Redevenue visible (import rejoué juste après) : rien à effacer ici.
  const row = await read()
  if (row?.deleted_at) {
    // Aussi quand elle était déjà supprimée : le retrait des favoris a pu échouer la première fois.
    await db.prepare("DELETE FROM favorites WHERE user_id = ?1 AND scope = 'mine' AND item_id = ?2").bind(account, id).run()
    await purgeFile(db, bucket, row)
  }
  return done
}

/**
 * Un import supprimé puis renvoyé avec la même clé d'import : la ligne redevient visible, à neuf, sur le fichier qui vient d'être écrit
 * dans R2 sous `key` (une clé neuve à chaque fois, voir POST /assets). `was` est la clé R2 de la ligne supprimée telle qu'on l'a lue :
 * la ligne n'est reprise que si elle est encore supprimée avec cette clé, donc un seul de deux envois simultanés la reprend.
 * Rend la ligne, ou null si un autre envoi (ou rien) l'a reprise.
 */
export async function reviveUpload(db, account, { id, kind, name, key, contentType, bytes, secs = null, width = null, height = null }, was, now = Date.now()) {
  const r = await db.prepare(`UPDATE assets SET deleted_at = NULL, kind = ?3, name = ?4, r2_key = ?5, content_type = ?6, bytes = ?7, width = ?8, height = ?9, secs = ?10, created_at = ?11
    WHERE id = ?1 AND user_id = ?2 AND source = 'upload' AND deleted_at IS NOT NULL AND r2_key = ?12`).bind(id, account, kind, name, key, contentType, bytes, width, height, secs, now, was).run()
  if (!((r.meta?.changes ?? 0) > 0)) return null
  return { id, user_id: account, kind, source: 'upload', name, r2_key: key, content_type: contentType, bytes, width, height, secs, prompt: null, model: null, job_id: null, idx: null, created_at: now }
}

export async function listFavorites(db, account) {
  const { results } = await db.prepare('SELECT scope, item_id, created_at FROM favorites WHERE user_id = ?1 ORDER BY created_at DESC').bind(account).all()
  return results.map((f) => ({ scope: f.scope, id: f.item_id, createdAt: f.created_at }))
}

export const addFavorite = (db, account, scope, id, now = Date.now()) =>
  db.prepare('INSERT INTO favorites (user_id, scope, item_id, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING').bind(account, scope, id, now).run()

export const removeFavorite = (db, account, scope, id) =>
  db.prepare('DELETE FROM favorites WHERE user_id = ?1 AND scope = ?2 AND item_id = ?3').bind(account, scope, id).run()

/** Bibliothèque Yeleen publiée, dans l'ordre choisi (`sort`), au format de `yeleen.json` : { items: [{ id, kind, category, name, url, secs, art, seed, placeholder }] }. */
export async function catalog(db) {
  const { results } = await db.prepare('SELECT id, kind, category, name, url, secs, art, seed, placeholder FROM catalog_items WHERE published = 1 ORDER BY sort, created_at').bind().all()
  return {
    items: results.map((e) => {
      let art = null
      try { art = e.art ? JSON.parse(e.art) : null } catch { /* exemple illisible : ignoré */ }
      return { id: e.id, kind: e.kind, category: e.category, name: e.name, url: e.url ?? undefined, secs: e.secs ?? undefined, art: art ?? undefined, seed: e.seed ?? 0, placeholder: Boolean(e.placeholder) }
    }),
  }
}

/** Une ligne `template_inputs` dans la forme du catalogue (voir templateSlots.js) : seuls les champs renseignés. */
export const inputOf = (r) => ({
  idx: r.idx, slot: r.slot, kind: r.kind, mode: r.mode, ...(r.file_key != null ? { file: r.file_key } : {}), ...(r.label != null ? { label: r.label } : {}),
  optional: Boolean(r.optional), ...(r.prompt != null ? { prompt: r.prompt } : {}), ...(r.from_idx != null ? { from: r.from_idx } : {}),
})
export const INPUT_COLS = 'i.template_id, i.idx, i.slot, i.kind, i.mode, i.file_key, i.label, i.optional, i.prompt, i.from_idx'
/**
 * Entrées de l'ancienne forme (colonnes `image` et `photo`). Une photo sans consigne d'image (`image` NULL) était l'image de début
 * jointe par l'utilisateur (migration 0006) : elle devient une entrée `start` à fournir, pour que la photo aille encore au modèle vidéo
 * et que l'administration ne perde pas l'exigence au premier enregistrement.
 */
const legacyOf = (t) => legacyInputs(t).map((i) => ({ ...i, optional: false }))
/** Entrées d'un modèle : ses lignes `template_inputs`, sinon celles de l'ancienne forme (colonnes `image` et `photo`). */
export const inputsOf = (t, rows) => (rows.length ? rows.map(inputOf) : legacyOf(t))
/** Lignes `template_inputs` d'un modèle, dans l'ordre. */
export const inputRows = async (db, id) => (await db.prepare(`SELECT ${INPUT_COLS} FROM template_inputs i WHERE i.template_id = ?1 ORDER BY i.idx`).bind(id).all()).results

/**
 * Entrées telles que l'application les reçoit : jamais la clé R2 d'un fichier fixe, mais son adresse (`url`) ; `optional` pour les
 * entrées à fournir seulement ; la consigne de Krea 3 d'une entrée créée (comme `image` jusqu'ici).
 */
export const publicInputs = (inputs, origin) => inputs.map(({ file, optional, ...i }) => ({
  ...i, ...(i.mode === 'user' ? { optional: Boolean(optional) } : {}), ...(i.mode === 'fixed' && file ? { url: `${origin}/files/${file}` } : {}),
}))

export const TEMPLATE_COLS = `t.id, t.name, t.blurb, t.category, t.video_key, t.image, t.model_id, t.plans, t.resolution, t.ratio, t.sound, t.photo, t.sort, t.published, t.created_at,
  g.tool AS g_tool, g.source_key AS g_source_key, g.secs AS g_secs, g.prompt AS g_prompt, g.roles AS g_roles`
/** Une ligne de `templates` (publiée ou non) avec sa source Genjutsu éventuelle (colonnes g_…), ou null. */
/** Un modèle et ses entrées lus ensemble (batch : même instantané) : { t, rows } (t = null s'il n'existe pas). */
export async function templateSnapshot(db, id) {
  const [a, b] = await db.batch([
    db.prepare(`SELECT ${TEMPLATE_COLS} FROM templates t LEFT JOIN template_genjutsu g ON g.template_id = t.id WHERE t.id = ?1`).bind(id),
    db.prepare(`SELECT ${INPUT_COLS} FROM template_inputs i WHERE i.template_id = ?1 ORDER BY i.idx`).bind(id),
  ])
  return { t: a.results[0] ?? null, rows: b.results }
}
export const templateRow = (db, id) => db.prepare(`SELECT ${TEMPLATE_COLS} FROM templates t LEFT JOIN template_genjutsu g ON g.template_id = t.id WHERE t.id = ?1`).bind(id).first()

/**
 * Un modèle tel que l'application le reçoit (GET /templates, aperçu de l'administration), ou null si ses plans ou ses rôles sont
 * illisibles. `inputs` : ses entrées ; `image` et `photo` restent pour les anciennes versions de l'application (déduites des entrées
 * quand il en a : consigne de l'image de début créée, libellé de sa photo).
 */
export function publicTemplate(t, rows, origin) {
  let plans
  let roles = null
  try { plans = JSON.parse(t.plans); if (t.g_tool) roles = JSON.parse(t.g_roles) } catch { return null }
  // Genjutsu : la vidéo est la source, pas de plans ; il faut au moins un rôle (une photo) et une durée.
  const genjutsu = t.g_tool ? { tool: t.g_tool, secs: t.g_secs, roles } : null
  if (genjutsu && (!Array.isArray(roles) || !roles.length || roles.some((r) => typeof r !== 'string') || !(genjutsu.secs > 0))) return null
  if (!genjutsu && (!Array.isArray(plans) || !plans.length || plans.some((p) => typeof p?.text !== 'string' || !(p.dur > 0)))) return null
  const inputs = genjutsu ? [] : inputsOf(t, rows)
  let image = t.image ?? null
  let photo = t.photo ?? null
  if (rows.length) {
    const start = inputs.find((i) => i.slot === 'start' && i.mode === 'generated')
    image = start?.prompt ?? null
    // Sans image de début créée : la photo à fournir est l'image de début elle-même (ancienne forme « photo seule »), si elle est obligatoire.
    photo = (start ? (start.from != null ? inputs.find((i) => i.idx === start.from)?.label : null)
      : inputs.find((i) => i.slot === 'start' && i.mode === 'user' && !i.optional)?.label) ?? null
  }
  return {
    id: t.id, name: t.name, blurb: t.blurb ?? null, category: t.category, video: `${origin}/files/${t.video_key}`, image, modelId: t.model_id,
    plans: genjutsu ? [] : plans.map((p) => ({ text: p.text, dur: p.dur })), resolution: t.resolution ?? null, ratio: t.ratio ?? null,
    sound: Boolean(t.sound), photo, inputs: publicInputs(inputs, origin), ...(genjutsu ? { genjutsu } : {}),
  }
}

/**
 * Vidéos à refaire publiées, dans l'ordre choisi : { templates: [{ id, name, blurb, category, video, image, modelId, plans, resolution,
 * ratio, sound, photo, inputs }] }. Les adresses sont celles de l'API (/files/templates/…). Une ligne aux plans illisibles est ignorée.
 */
export async function listTemplates(db, origin) {
  // Une seule lecture (batch : même instantané) : un enregistrement concurrent ne mêle pas l'ancien modèle et les nouvelles entrées.
  const [{ results }, { results: all }] = await db.batch([
    db.prepare(`SELECT ${TEMPLATE_COLS} FROM templates t LEFT JOIN template_genjutsu g ON g.template_id = t.id
      WHERE t.published = 1 ORDER BY t.sort, t.created_at`).bind(),
    db.prepare(`SELECT ${INPUT_COLS} FROM template_inputs i JOIN templates t ON t.id = i.template_id WHERE t.published = 1 ORDER BY i.template_id, i.idx`).bind(),
  ])
  const rows = new Map()
  for (const r of all) rows.set(r.template_id, [...(rows.get(r.template_id) ?? []), r])
  return { templates: results.flatMap((t) => publicTemplate(t, rows.get(t.id) ?? [], origin) ?? []) }
}

const TEMPLATE_ID = /^[\w-]{1,80}$/
/**
 * Source Genjutsu d'une vidéo à refaire publiée (ou non, pour un administrateur : `unpublished`) : { tool, sourceKey, secs, prompt,
 * roles }, ou null. Lue au lancement : la vidéo source, sa durée (le prix) et la consigne viennent d'ici, jamais de l'application.
 */
export async function templateSource(db, id, { unpublished = false } = {}) {
  if (typeof id !== 'string' || !TEMPLATE_ID.test(id)) return null
  const g = await db.prepare(`SELECT g.tool, g.source_key, g.secs, g.prompt, g.roles FROM template_genjutsu g JOIN templates t ON t.id = g.template_id
    WHERE g.template_id = ?1 AND (t.published = 1 OR ?2 = 1)`).bind(id, unpublished ? 1 : 0).first()
  if (!g || !g.source_key || !(g.secs > 0)) return null // brouillon incomplet : pas de source ou pas de durée
  let roles
  try { roles = JSON.parse(g.roles) } catch { return null }
  return Array.isArray(roles) && roles.length ? { tool: g.tool, sourceKey: g.source_key, secs: g.secs, prompt: g.prompt, roles } : null
}

/**
 * Vidéo à refaire par le générateur de vidéos, au lancement : { id, modelId, inputs }, ou null (inconnue, non publiée sauf pour un
 * administrateur, ou faite par Genjutsu). Les entrées (fichiers fixes, ce que l'utilisateur fournit) font foi, pas l'application.
 */
export async function videoTemplate(db, id, { unpublished = false } = {}) {
  if (typeof id !== 'string' || !TEMPLATE_ID.test(id)) return null
  const { t, rows } = await templateSnapshot(db, id)
  if (!t || t.g_tool || (!t.published && !unpublished)) return null
  return { id: t.id, modelId: t.model_id, inputs: inputsOf(t, rows) }
}
