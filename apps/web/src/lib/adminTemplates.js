import { IMAGE_MODELS, VIDEO_MODELS, durationOptions, findModel, imageCost, videoCost } from '@studio/catalog'
import { findTool, toolCost } from '@studio/catalog/tools'
import { KINDS, LIMITS, findVideoModel, inputIssues, slotRules, slotTokens, userInputs } from '@studio/catalog/template-slots'
import { adminError } from './admin.js'

/**
 * Administration des vidéos à refaire (onglet « Modèles ») : logique pure de l'éditeur et de la liste, sans React ni navigateur
 * (testée par node --test). Les règles d'entrée viennent du catalogue (template-slots) : l'API applique les mêmes.
 */

/** Outils Genjutsu proposés dans l'éditeur. */
export const GENJUTSU_TOOLS = ['motion-transfer', 'object-swap']
export const GENJUTSU_LIMITS = { minSecs: 4, maxSecs: 20, prompt: 10000, roles: 8, role: 120 }
export const BLURB_MAX = 160
export const NAME_MAX = 80

/** Catégories connues (identifiant → libellé) ; une autre se saisit librement. */
export const CATEGORIES = [
  ['danse', 'Danse'], ['lifestyle', 'Lifestyle'], ['animaux', 'Animaux'], ['cinema', 'Cinéma'], ['explication', 'Explication'], ['pub', 'Pub'],
  ['produit', 'Produit'], ['fete', 'Fête'], ['mode', 'Mode'], ['cuisine', 'Cuisine'], ['immobilier', 'Immobilier'], ['musique', 'Musique'],
  ['evenement', 'Événement'], ['voyage', 'Voyage'], ['autres', 'Autres'],
]
export const isCategory = (c) => /^[a-z0-9-]{1,30}$/.test(c ?? '')

/** Types de fichiers acceptés au dépôt, par rôle et par sorte d'entrée (comme l'API). */
export const ACCEPT = {
  video: 'video/mp4,video/webm,video/quicktime',
  source: 'video/mp4,video/webm,video/quicktime',
  image: 'image/png,image/jpeg,image/webp',
  // Une vidéo d'entrée : pas de QuickTime (l'API ne l'accepte qu'en vidéo d'exemple ou en source).
  videoInput: 'video/mp4,video/webm',
  audio: 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg',
}
export const acceptFor = (kind) => (kind === 'video' ? ACCEPT.videoInput : ACCEPT[kind])

/* ——— Messages ——— */

// Champs refusés par l'API (`invalid_field`), en clair.
const FIELD_LABEL = { name: 'le nom', blurb: 'la phrase au survol', category: 'la catégorie', videoKey: 'la vidéo d’exemple', resolution: 'la résolution', ratio: 'le format', sound: 'le son', plans: 'les plans', 'inputs.file': 'un fichier fixe', 'genjutsu.tool': 'l’outil Genjutsu', 'genjutsu.sourceKey': 'la vidéo source', 'genjutsu.secs': 'la durée de la source', 'genjutsu.prompt': 'la consigne Genjutsu', 'genjutsu.roles': 'les photos demandées' }
const KIND_LABEL = { image: 'images', video: 'vidéos', audio: 'audios' }

/** Problème (code stable de l'API ou de template-slots) → phrase française. */
const ISSUES = {
  unknown_model: 'Ce modèle vidéo n’existe pas dans le catalogue.',
  invalid_field: 'Valeur refusée : {field}.',
  model_removed: 'Modèle retiré du catalogue : choisissez-en un autre.',
  bad_inputs: 'La liste des entrées est illisible.',
  too_many_inputs: `Trop d’entrées (${LIMITS.inputs} au plus).`,
  bad_idx: 'Numéro d’entrée manquant ou en double.',
  bad_input: 'Entrée incomplète (emplacement, sorte ou mode inconnus).',
  bad_kind: 'Cette sorte de fichier ne va pas à cet emplacement.',
  fixed_needs_file: 'Déposez le fichier de cette entrée fixe.',
  user_needs_label: `Écrivez ce qu’on demande à l’utilisateur (${LIMITS.label} caractères au plus).`,
  generated_only_frames: 'Seules les images de début et de fin peuvent être créées par Krea 3.',
  generated_needs_prompt: `Écrivez la consigne Krea 3 (${LIMITS.prompt} caractères au plus).`,
  bad_from: 'La photo de départ de l’image créée n’existe plus.',
  source_is_user: 'La photo de départ doit venir de l’utilisateur.',
  source_unused: 'Cette photo de l’utilisateur ne sert à aucune image créée.',
  one_start: 'Une seule image de début.',
  one_end: 'Une seule image de fin.',
  start_unsupported: 'Ce modèle ne prend pas d’image de début.',
  start_required: 'Ce modèle exige une image de début, obligatoire pour l’utilisateur.',
  end_unsupported: 'Ce modèle ne prend pas d’image de fin.',
  end_needs_start: 'Avec ce modèle, l’image de fin demande aussi une image de début.',
  too_many_elements: 'Trop d’éléments pour ce modèle.',
  elements_unsupported: 'Ce modèle ne prend pas d’éléments.',
  references_unsupported: 'Ce modèle ne prend pas de références.',
  too_many_references: 'Trop de références ({kind}) pour ce modèle.',
  frames_with_references: 'Ce modèle ne combine pas les images de début et de fin avec des références : retirez les unes ou les autres.',
  one_audio: 'Un seul son.',
  audio_unsupported: 'Ce modèle ne prend pas de son à suivre.',
  audio_required: 'Ce modèle exige un son.',
  no_video: 'Ajoutez la vidéo d’exemple.',
  bad_plans: 'Plans invalides : de 1 à 4 (plusieurs seulement si le modèle les accepte), chacun avec une durée et 2 000 caractères au plus.',
  genjutsu_incomplete: 'Genjutsu incomplet : vidéo source, durée (4 à 20 s), consigne et au moins un rôle.',
  invalid_template: 'Le modèle n’est pas valide : corrigez les points signalés.',
  too_large: 'Fichier trop lourd : images 10 Mo, sons 15 Mo, vidéo d’exemple 20 Mo, autres vidéos 100 Mo au plus.',
  unsupported_type: 'Format de fichier refusé pour cet emplacement (ou contenu qui ne correspond pas à son type).',
  length_required: 'Taille du fichier inconnue : réessayez le dépôt.',
  not_found: 'Ce modèle n’existe plus.',
  conflict: 'Ce modèle a été modifié entre-temps (autre administrateur) : rechargez-le, puis recommencez.',
  unknown_template: 'Ce modèle n’existe plus.',
  files_in_use: 'Fichier encore utilisé par d’autres modèles{templates} : retirez-le d’abord de ceux-ci.',
  missing_file: 'Fichier introuvable dans le stockage{key} : déposez-le à nouveau.',
  bad_duration: 'Durée refusée par ce modèle vidéo : choisissez une durée proposée.',
  bad_dur: 'Durée refusée par ce modèle vidéo : choisissez une durée proposée.',
  bad_secs: 'Durée de la vidéo source hors limites (4 à 20 s).',
  kind_mismatch: 'Le fichier déposé n’est pas de la sorte attendue (image, vidéo ou audio).',
  optional_not_last: 'Une entrée facultative doit venir après les entrées obligatoires de la même sorte (éléments, images, vidéos ou sons) : déplacez-la à la fin.',
  cannot_be_optional: 'La photo source ne peut pas être facultative : l’image créée à partir d’elle est toujours nécessaire.',
  plan_empty: 'Un plan est vide : écrivez son texte.',
  blank_plan: 'Un plan est vide : écrivez son texte.',
  empty_plan: 'Un plan est vide : écrivez son texte.',
  invalid_ids: 'L’ordre envoyé ne correspond plus à la liste : rechargez la page.',
  invalid_role: 'Sorte de fichier inconnue pour ce dépôt.',
  invalid_published: 'Valeur de publication refusée.',
  storage_unavailable: 'Stockage des fichiers indisponible : réessayez dans un instant.',
}

// Détails facultatifs d'un problème : modèles concernés (noms ou { name, id }) et clé de fichier.
const names = (list) => (Array.isArray(list) ? list.map((t) => (typeof t === 'string' ? t : t?.name ?? t?.id)).filter(Boolean) : [])
function fill(msg, issue) {
  const tpls = names(issue?.templates)
  const key = typeof issue?.key === 'string' && issue.key ? issue.key.split('/').pop() : ''
  return msg
    .replace('{kind}', KIND_LABEL[issue?.kind] ?? 'fichiers')
    .replace('{field}', FIELD_LABEL[issue?.field] ?? (typeof issue?.field === 'string' ? issue.field : 'un champ'))
    .replace('{templates}', tpls.length ? ` (${tpls.map((n) => `« ${n} »`).join(', ')})` : '')
    .replace('{key}', key ? ` (${key})` : '')
}

/** Titre d'une entrée, pour l'éditeur et les messages. */
export function inputTitle(i) {
  if (!i) return 'Entrée'
  if (i.slot === 'start') return 'Image de début'
  if (i.slot === 'end') return 'Image de fin'
  if (i.slot === 'audio') return 'Son'
  if (i.slot === 'source') return 'Photo de départ'
  if (i.slot === 'element') return i.kind === 'video' ? 'Élément vidéo' : 'Élément'
  return { image: 'Référence image', video: 'Référence vidéo', audio: 'Référence audio' }[i.kind] ?? 'Référence'
}

/** Un problème en français ; avec `inputs`, préfixé de l'entrée concernée (« Élément @Element2 : … »). */
export function issueText(issue, inputs = []) {
  const code = issue?.code
  const msg = Object.hasOwn(ISSUES, code ?? '') ? fill(ISSUES[code], issue) : `Problème à corriger (${code ?? 'inconnu'}).`
  if (issue?.idx == null || !Array.isArray(inputs)) return msg
  const i = inputs.find((x) => x?.idx === issue.idx)
  if (!i) return msg
  const tok = slotTokens(inputs)[i.idx]
  return `${inputTitle(i)}${tok ? ` ${tok}` : ''} : ${msg}`
}

/** Erreur d'un appel de l'administration des modèles → { message, issues } (issues : les problèmes renvoyés, s'il y en a). */
export function templateError(err) {
  const body = err?.body ?? {}
  const issues = Array.isArray(body.issues) ? body.issues : []
  const code = body.error ?? err?.error
  if (err?.status && err.status !== 401 && err.status !== 403 && Object.hasOwn(ISSUES, code ?? '')) return { message: fill(ISSUES[code], body), issues }
  return { message: adminError(err), issues }
}

/* ——— Liste ——— */

/** Le modèle est-il un Genjutsu ? */
export const isGenjutsu = (t) => Boolean(t?.genjutsu)

/** Filtre de la liste : recherche (nom, catégorie, nom ou identifiant du modèle) et segment. */
export function filterTemplates(list, { q = '', filter = 'all' } = {}) {
  const words = q.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/\s+/).filter(Boolean)
  return list.filter((t) => {
    if (filter === 'published' && !t.published) return false
    if (filter === 'draft' && t.published) return false
    if (filter === 'fix' && !t.issues?.length) return false
    if (!words.length) return true
    const hay = [t.name, t.category, t.modelId, findVideoModel(t.modelId)?.name, t.genjutsu && findTool(t.genjutsu.tool)?.name]
      .filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    return words.every((w) => hay.includes(w))
  })
}

/** Compteurs au-dessus de la liste. */
export const summarize = (list) => ({
  total: list.length,
  published: list.filter((t) => t.published).length,
  fix: list.filter((t) => t.issues?.length).length,
})

/** Déplace `id` juste avant `beforeId` (null : à la fin). Rend un nouvel ordre. */
export function moveBefore(ids, id, beforeId) {
  if (id === beforeId) return [...ids]
  const rest = ids.filter((x) => x !== id)
  const at = beforeId == null ? rest.length : rest.indexOf(beforeId)
  if (at < 0 || !ids.includes(id)) return [...ids]
  rest.splice(at, 0, id)
  return rest
}

/**
 * Monte (delta -1) ou descend (+1) `id` d'un cran parmi les lignes visibles (`visible`, liste filtrée), dans l'ordre complet
 * `ids` : il prend la place de son voisin visible. Rend null s'il est déjà au bout.
 */
export function moveStep(ids, visible, id, delta) {
  const v = visible.indexOf(id)
  const other = visible[v + delta]
  if (v < 0 || other == null) return null
  const rest = ids.filter((x) => x !== id)
  const at = rest.indexOf(other) + (delta > 0 ? 1 : 0)
  rest.splice(at, 0, id)
  return rest
}

/** Ligne « Fabrication » : { kind, detail, error } ; `error` si le modèle vidéo a été retiré du catalogue. */
export function fabrication(t) {
  if (isGenjutsu(t)) {
    const n = t.genjutsu.roles?.length ?? 0
    return { kind: 'Genjutsu', detail: `${findTool(t.genjutsu.tool)?.name ?? t.genjutsu.tool} · ${n} photo${n > 1 ? 's' : ''}`, error: false }
  }
  const m = findVideoModel(t.modelId)
  if (!m) return { kind: 'Générateur', detail: 'Modèle retiré du catalogue', error: true }
  const n = t.plans?.length ?? 0
  const res = m.caps.resolutions ? t.resolution ?? m.caps.resolutions[0] : null
  return { kind: 'Générateur', detail: [m.name, `${n} plan${n > 1 ? 's' : ''}`, res].filter(Boolean).join(' · '), error: false }
}

/* ——— Prix ——— */

const KREA = IMAGE_MODELS.find((m) => m.id === 'krea-3')
const TPL_TOOL = findTool('template-image')

/** Coût Krea 3 d'une image créée (comme Cinéma : retouche de la photo de l'utilisateur, ou création du texte seul en 2K). */
export function kreaCost(input, ratio = '9:16') {
  if (input.from != null && TPL_TOOL) return toolCost(TPL_TOOL, { model: 'krea-3', images: ['fichier'], prompt: input.prompt ?? '', ratio })
  return imageCost(KREA, '2K', 1)
}

const secsOf = (plans) => (plans ?? []).reduce((n, p) => n + (Number(p.dur) || 0), 0)
const round = (n) => Math.round(n * 10) / 10

/**
 * Prix pour l'utilisateur, détaillé : { total, secs, lines: [{ label, cost }] } ; null si le modèle (ou l'outil) n'existe plus ou
 * si la durée manque. Même calcul que templateCost (lib/templates.js), plus Krea 3 pour chaque image créée.
 */
export function templatePrice(t) {
  if (isGenjutsu(t)) {
    const tool = findTool(t.genjutsu.tool)
    const secs = Number(t.genjutsu.secs)
    if (!tool || !(secs > 0)) return null
    const cost = toolCost(tool, { resolution: '480p' }, secs)
    return { total: cost, secs, lines: [{ label: `${tool.name}, 480p, ${secs} s`, cost }] }
  }
  const m = findVideoModel(t.modelId)
  const secs = secsOf(t.plans)
  if (!m || !(secs > 0)) return null
  const res = m.caps.resolutions ? (t.resolution ?? m.caps.resolutions[0]) : undefined
  const video = videoCost(findModel(VIDEO_MODELS, m.id), secs, res, { sound: t.sound !== false })
  const lines = [{ label: [m.name, res, `${secs} s`].filter(Boolean).join(', '), cost: video }]
  for (const i of [...(t.inputs ?? [])].sort((a, b) => a.idx - b.idx)) {
    if (i.mode === 'generated') lines.push({ label: `${inputTitle(i)} (Krea 3)`, cost: kreaCost(i, t.ratio && t.ratio !== 'auto' ? t.ratio : '9:16') })
  }
  return { total: round(lines.reduce((n, l) => n + l.cost, 0)), secs, lines }
}

/* ——— Brouillon de l'éditeur ——— */

/** Modèle (forme admin de l'API) → brouillon de l'éditeur. Les deux fabrications sont gardées pour passer de l'une à l'autre. */
export function fromTemplate(t) {
  const g = t.genjutsu
  return {
    kind: g ? 'genjutsu' : 'generator',
    name: t.name ?? '',
    blurb: t.blurb ?? '',
    category: t.category ?? 'autres',
    videoKey: t.videoKey ?? '',
    video: t.video ?? null,
    modelId: g ? 'seedance-2-5' : t.modelId,
    plans: g || !t.plans?.length ? [{ text: '', dur: 5 }] : t.plans.map((p) => ({ text: p.text ?? '', dur: p.dur })),
    resolution: t.resolution ?? null,
    ratio: t.ratio ?? null,
    sound: t.sound !== false,
    inputs: g ? [] : (t.inputs ?? []).map(cleanInput),
    genjutsu: {
      tool: g?.tool ?? GENJUTSU_TOOLS[0], sourceKey: g?.sourceKey ?? '', source: g?.source ?? null,
      secs: g?.secs ?? null, prompt: g?.prompt ?? '', roles: g?.roles?.length ? [...g.roles] : [''],
    },
  }
}

/** Une entrée réduite à ses champs utiles (l'URL d'aperçu est gardée pour l'affichage, jamais envoyée). */
function cleanInput(i) {
  const o = { idx: i.idx, slot: i.slot, kind: i.kind, mode: i.mode }
  if (i.mode === 'fixed') { if (i.file) o.file = i.file; if (i.url) o.url = i.url }
  if (i.mode === 'user') { o.label = i.label ?? ''; o.optional = Boolean(i.optional) }
  if (i.mode === 'generated') { o.prompt = i.prompt ?? ''; if (i.from != null) o.from = i.from }
  return o
}

/** Brouillon → corps de PUT /admin/templates/:id. */
export function toPayload(d) {
  const base = { name: d.name.trim(), blurb: d.blurb.trim(), category: d.category.trim(), videoKey: d.videoKey ?? '' }
  if (d.kind === 'genjutsu') {
    const g = d.genjutsu
    return {
      ...base, modelId: d.modelId, plans: d.plans, resolution: null, ratio: d.ratio ?? null, sound: d.sound, inputs: [],
      genjutsu: { tool: g.tool, sourceKey: g.sourceKey, secs: Number(g.secs), prompt: g.prompt.trim(), roles: g.roles.map((r) => r.trim()) },
    }
  }
  return {
    ...base, modelId: d.modelId, plans: d.plans.map((p) => ({ text: p.text, dur: Number(p.dur) })), resolution: d.resolution, ratio: d.ratio,
    sound: d.sound, genjutsu: null,
    // Une entrée fixe encore sans fichier part sans `file` (jamais ''), pour que l'API garde le brouillon et signale fixed_needs_file.
    inputs: d.inputs.map(({ url, ...i }) => {
      if (i.mode === 'user') return { ...i, label: i.label.trim() }
      if (i.mode === 'fixed' && !i.file) { const { file, ...rest } = i; return rest }
      return i
    }),
  }
}

/** Formats proposés pour un modèle Genjutsu (celui de la vidéo source : il règle la carte dans Cinéma). */
export const GENJUTSU_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']

/**
 * Un clic sur ce lien quitte-t-il la page en cours (navigation dans l'application) ? Faux pour les clics modifiés (nouvel onglet),
 * les liens vers un autre onglet, les téléchargements, les autres sites et le lien vers l'adresse actuelle.
 */
export function isLeavingClick(e, a, here) {
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  if ((a.target && a.target !== '_self') || a.hasAttribute?.('download')) return false
  let to
  try { to = new URL(a.href, here) } catch { return false }
  const cur = new URL(here)
  if (to.origin !== cur.origin) return false
  return to.pathname + to.search !== cur.pathname + cur.search
}

/** Le brouillon a-t-il changé depuis le dernier enregistrement ? (on compare ce qui serait envoyé) */
export const isDirty = (draft, saved) => JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(saved))

/** Problèmes des plans pour un modèle vidéo ([] ou [{ code: 'bad_plans' }]). */
export function planIssues(model, plans) {
  const max = model?.caps?.multiShot ? 4 : 1
  const ok = Array.isArray(plans) && plans.length >= 1 && plans.length <= max
    && plans.every((p) => typeof p.text === 'string' && p.text.length <= 2000 && Number(p.dur) > 0)
  return ok ? [] : [{ code: 'bad_plans' }]
}

/** Problèmes d'un brouillon, comme l'API les calcule (aperçu immédiat dans l'éditeur). */
export function draftIssues(d) {
  const out = []
  if (d.kind === 'genjutsu') {
    const g = d.genjutsu
    const secs = Number(g.secs)
    const ok = GENJUTSU_TOOLS.includes(g.tool) && g.sourceKey?.startsWith('templates/') && secs >= GENJUTSU_LIMITS.minSecs && secs <= GENJUTSU_LIMITS.maxSecs
      && g.prompt.trim() && g.prompt.length <= GENJUTSU_LIMITS.prompt
      && g.roles.length >= 1 && g.roles.length <= GENJUTSU_LIMITS.roles && g.roles.every((r) => r.trim() && r.length <= GENJUTSU_LIMITS.role)
    if (!ok) out.push({ code: 'genjutsu_incomplete' })
  } else {
    const m = findVideoModel(d.modelId)
    if (!m) out.push({ code: 'model_removed' })
    else out.push(...inputIssues(m, d.inputs), ...planIssues(m, d.plans))
  }
  if (!d.videoKey) out.push({ code: 'no_video' })
  return out
}

/* ——— Réglages du modèle vidéo ——— */

/** Le son se choisit-il ? (non quand le modèle le génère toujours ou qu'il vient de l'utilisateur) */
export const soundChoice = (model) => Boolean(model?.caps?.audio) && !['always', 'provided'].includes(model.caps.audio)

/** Durées proposées pour un plan (la valeur actuelle reste proposée même hors liste). */
export function durationsFor(model, current) {
  const list = model ? durationOptions(model.caps) : []
  const n = Number(current)
  return n > 0 && !list.includes(n) ? [...list, n].sort((a, b) => a - b) : list
}

/** Pastilles de capacités du modèle vidéo : [{ label, off }]. */
export function capChips(model) {
  if (!model) return []
  const r = slotRules(model)
  const chips = []
  chips.push({ label: r.start === 'required' ? 'Image de début · obligatoire' : 'Image de début', off: !r.start })
  chips.push({ label: 'Image de fin', off: !r.end })
  if (r.elements) chips.push({ label: `${r.elements} élément${r.elements > 1 ? 's' : ''}`, off: false })
  if (r.references) for (const k of KINDS) if (r.references[k]) chips.push({ label: `${r.references[k]} ${KIND_LABEL[k]}`, off: false })
  chips.push({ label: 'Plusieurs plans', off: !r.multiShot })
  if (r.audio) chips.push({ label: r.audio === 'required' ? 'Son · obligatoire' : 'Son à suivre', off: false })
  if (!r.references) chips.push({ label: 'Références', off: true })
  return chips
}

/** Avertissement Seedance : images de début ou de fin et références ensemble. */
export function framesRefsWarning(model, inputs) {
  const r = slotRules(model)
  if (!r.references || (!r.start && !r.end)) return false
  return inputs.some((i) => i.slot === 'reference') && inputs.some((i) => i.slot === 'start' || i.slot === 'end')
}

/* ——— Entrées ——— */

/** Ajouts possibles pour ce modèle, compte tenu des entrées déjà là : [{ id, label, slot, kind }]. */
export function allowedAdds(model, inputs) {
  if (!model) return []
  const r = slotRules(model)
  const n = (pred) => inputs.filter(pred).length
  const out = []
  if (r.start && !n((i) => i.slot === 'start')) out.push({ id: 'start', label: 'Image de début', slot: 'start', kind: 'image' })
  if (r.end && !n((i) => i.slot === 'end')) out.push({ id: 'end', label: 'Image de fin', slot: 'end', kind: 'image' })
  if (r.elements > n((i) => i.slot === 'element')) out.push({ id: 'element', label: 'Élément', slot: 'element', kind: 'image' })
  if (r.references) {
    for (const k of KINDS) {
      if (r.references[k] > n((i) => i.slot === 'reference' && i.kind === k)) {
        out.push({ id: `ref-${k}`, label: { image: 'Référence image', video: 'Référence vidéo', audio: 'Référence audio' }[k], slot: 'reference', kind: k })
      }
    }
  }
  if (r.audio && !n((i) => i.slot === 'audio')) out.push({ id: 'audio', label: 'Son', slot: 'audio', kind: 'audio' })
  return out
}

/** Renumérote les entrées 0..n-1 dans leur ordre, en suivant les liens `from`. */
export function renumber(inputs) {
  const sorted = [...inputs].sort((a, b) => a.idx - b.idx)
  const map = new Map(sorted.map((i, n) => [i.idx, n]))
  return sorted.map((i, n) => {
    const o = { ...i, idx: n }
    if (i.from != null) { if (map.has(i.from)) o.from = map.get(i.from); else delete o.from }
    return o
  })
}

const nextIdx = (inputs) => inputs.reduce((n, i) => Math.max(n, i.idx + 1), 0)

/** Ajoute une entrée (à fournir par l'utilisateur, à décrire) à la fin. */
export function addInput(inputs, { slot, kind }) {
  return [...inputs, { idx: nextIdx(inputs), slot, kind, mode: 'user', label: '', optional: false }]
}

/** Retire une entrée ; une image créée emporte sa photo de départ, une photo de départ retirée détache l'image créée. */
export function removeInput(inputs, idx) {
  const gone = inputs.find((i) => i.idx === idx)
  if (!gone) return inputs
  const drop = new Set([idx])
  if (gone.mode === 'generated' && gone.from != null) drop.add(gone.from)
  return renumber(inputs.filter((i) => !drop.has(i.idx)).map((i) => {
    if (i.from == null || !drop.has(i.from)) return i
    const { from, ...rest } = i
    return rest
  }))
}

/** Modifie les champs d'une entrée. */
export const patchInput = (inputs, idx, patch) => inputs.map((i) => (i.idx === idx ? { ...i, ...patch } : i))

/** Change le mode d'une entrée (fixe, à fournir, créée) ; les champs de l'ancien mode sont retirés. */
export function setMode(inputs, idx, mode) {
  const cur = inputs.find((i) => i.idx === idx)
  if (!cur || cur.mode === mode) return inputs
  if (mode === 'generated' && cur.slot !== 'start' && cur.slot !== 'end') return inputs
  const base = { idx: cur.idx, slot: cur.slot, kind: mode === 'generated' ? 'image' : cur.kind, mode }
  const next = mode === 'fixed' ? { ...base, file: '' } : mode === 'user' ? { ...base, label: '', optional: false } : { ...base, prompt: '' }
  let list = inputs.map((i) => (i.idx === idx ? next : i))
  if (cur.mode === 'generated' && cur.from != null) list = renumber(list.filter((i) => i.idx !== cur.from))
  return list
}

/** Coche ou décoche « À partir d'une photo de l'utilisateur » d'une image créée : ajoute ou retire l'entrée `source` liée. */
export function toggleSource(inputs, idx, on, label = 'Votre photo') {
  const cur = inputs.find((i) => i.idx === idx)
  if (!cur || cur.mode !== 'generated') return inputs
  if (on) {
    if (cur.from != null) return inputs
    const src = nextIdx(inputs)
    return [...patchInput(inputs, idx, { from: src }), { idx: src, slot: 'source', kind: 'image', mode: 'user', label, optional: false }]
  }
  if (cur.from == null) return inputs
  const { from, ...rest } = cur
  return renumber(inputs.filter((i) => i.idx !== from).map((i) => (i.idx === idx ? rest : i)))
}

/** Insère `token` dans `text` à la place de la sélection [start, end) : { text, caret }. Ajoute des espaces au besoin. */
export function insertToken(text, token, start = text.length, end = start) {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const pre = before && !/\s$/.test(before) ? ' ' : ''
  const post = after && !/^\s/.test(after) ? ' ' : ''
  const out = `${before}${pre}${token}${post}${after}`
  return { text: out, caret: before.length + pre.length + token.length + post.length }
}

/** Jetons à proposer dans « Insérer : », dans l'ordre des entrées. */
export function tokenList(inputs) {
  const t = slotTokens(inputs)
  return [...inputs].sort((a, b) => a.idx - b.idx).map((i) => t[i.idx]).filter(Boolean)
}

/** « Ce que l'utilisateur fournit » : [{ label, value }] par sorte de fichier ; texte libre non demandé. */
export function userNeeds(d) {
  if (d.kind === 'genjutsu') {
    const roles = d.genjutsu.roles.filter((r) => r.trim())
    return [{ label: 'Photos', value: roles.length ? `${roles.length} : ${roles.join(', ')}` : 'aucune' }]
  }
  const list = userInputs(d.inputs)
  const rows = []
  for (const [k, label] of [['image', 'Photos'], ['video', 'Vidéos'], ['audio', 'Audio']]) {
    const of = list.filter((i) => i.kind === k)
    if (!of.length) continue
    const req = of.filter((i) => !i.optional)
    rows.push({ label, value: `${of.length} : ${of.map((i) => (i.label?.trim() || '(sans nom)') + (i.optional ? ' (facultatif)' : '')).join(', ')}`, required: req.length })
  }
  return rows.length ? rows : [{ label: 'Fichiers', value: 'aucun' }]
}

/* ——— Enregistrements concurrents ——— */

/**
 * Brouillon à garder après un enregistrement réussi : `fresh` (le modèle renvoyé par l'API) si le brouillon courant `cur` est encore
 * celui envoyé (`sent`) ; sinon `cur`, pour ne pas perdre ce qui a été saisi pendant l'envoi.
 */
export const draftAfterSave = (cur, sent, fresh) => (cur && sent && isDirty(cur, sent) ? cur : fresh)

/**
 * Envois en série, la dernière valeur gagne : un seul appel `run` à la fois ; les valeurs soumises pendant un appel sont fusionnées
 * (seule la dernière part, après lui). Une erreur abandonne les valeurs en attente et passe à `onError`.
 */
export function serialLatest(run, onError = () => {}) {
  let running = null
  let next = null
  return function submit(value) {
    next = { value }
    if (running) return running
    running = (async () => {
      try {
        while (next) {
          const { value: v } = next
          next = null
          await run(v)
        }
      } catch (e) {
        next = null
        onError(e)
      } finally { running = null }
    })()
    return running
  }
}
