import { VIDEO_MODELS } from './models.js'

/**
 * Entrées d'une vidéo à refaire (Modèles) : ce que le modèle vidéo reçoit en plus du texte, et d'où vient chaque fichier.
 * Une seule source pour l'administration (éditeur), l'API (enregistrement, génération) et Cinéma (ce qu'on demande à l'utilisateur).
 *
 * Une entrée : { idx, slot, kind, mode, file?, label?, optional?, prompt?, from? }
 * - `slot` : `start` (image de début), `end` (image de fin), `element` (personnage ou objet de Kling 3, « @Element1 »),
 *   `reference` (référence de Seedance 2.5, « @Image1 », « @Video1 », « @Audio1 »), `audio` (son à suivre : H3 Max, LTX audio),
 *   `source` (photo de l'utilisateur qui ne va pas au modèle vidéo : elle sert à fabriquer une image `generated`).
 * - `kind` : `image`, `video` ou `audio`.
 * - `mode` : `fixed` (fichier déposé par l'administration, `file` = clé dans le bucket), `user` (fourni par l'utilisateur, `label`
 *   = ce qu'on lui demande, `optional` s'il peut s'en passer), `generated` (image de début ou de fin créée par Krea 3 à partir de
 *   `prompt`, et de la photo de l'entrée `from` si elle est donnée).
 * - `idx` : ordre d'affichage et de numérotation (« @Element1 » est le premier élément, etc.), unique dans le modèle.
 */
export const SLOTS = ['start', 'end', 'element', 'reference', 'audio', 'source']
export const KINDS = ['image', 'video', 'audio']
export const MODES = ['fixed', 'user', 'generated']
export const LIMITS = { label: 120, prompt: 2000, inputs: 50 }

/** Ce que le modèle vidéo accepte, ramené aux entrées d'un modèle de vidéo. */
export function slotRules(model) {
  const c = model?.caps ?? {}
  const refs = c.references ?? null
  return {
    start: c.startFrame === 'required' ? 'required' : c.startFrame === 'optional' ? 'optional' : null,
    end: c.endFrame === 'withStart' ? 'withStart' : c.endFrame ? true : false,
    elements: c.elements ? c.maxElements ?? 0 : 0,
    references: refs ? { image: refs.images ?? 0, video: refs.videos ?? 0, audio: refs.audios ?? 0 } : null,
    audio: c.audioRef === 'required' ? 'required' : c.audioRef ? 'optional' : null,
    multiShot: Boolean(c.multiShot),
  }
}

export const findVideoModel = (id) => VIDEO_MODELS.find((m) => m.id === id) ?? null

/** Jeton à citer dans le texte pour une entrée (« @Element2 », « @Image1 »…) ; null pour une entrée qui ne se cite pas. */
export function slotTokens(inputs) {
  const out = {}
  const n = { element: 0, image: 0, video: 0, audio: 0 }
  for (const i of [...inputs].sort((a, b) => a.idx - b.idx)) {
    if (i.slot === 'element') out[i.idx] = `@Element${++n.element}`
    else if (i.slot === 'reference') out[i.idx] = `@${i.kind[0].toUpperCase()}${i.kind.slice(1)}${++n[i.kind]}`
  }
  return out
}

const KIND_OF = { start: ['image'], end: ['image'], element: ['image', 'video'], reference: ['image', 'video', 'audio'], audio: ['audio'], source: ['image'] }

/**
 * Problèmes d'une liste d'entrées pour un modèle vidéo (identifiants stables, traduits par l'interface) ; [] si tout va bien.
 * Chaque problème : { code, idx? }. Sert à l'enregistrement (API) et à l'éditeur (administration).
 */
export function inputIssues(model, inputs) {
  const issues = []
  if (!model) return [{ code: 'unknown_model' }]
  if (!Array.isArray(inputs)) return [{ code: 'bad_inputs' }]
  if (inputs.length > LIMITS.inputs) issues.push({ code: 'too_many_inputs' })
  const r = slotRules(model)
  const seen = new Set()
  const count = (pred) => inputs.filter(pred).length
  for (const i of inputs) {
    const at = { idx: i?.idx }
    if (!i || !Number.isInteger(i.idx) || i.idx < 0 || seen.has(i.idx)) { issues.push({ code: 'bad_idx', ...at }); continue }
    seen.add(i.idx)
    if (!SLOTS.includes(i.slot) || !KINDS.includes(i.kind) || !MODES.includes(i.mode)) { issues.push({ code: 'bad_input', ...at }); continue }
    if (!KIND_OF[i.slot].includes(i.kind)) issues.push({ code: 'bad_kind', ...at })
    if (i.mode === 'fixed' && (typeof i.file !== 'string' || !i.file.startsWith('templates/'))) issues.push({ code: 'fixed_needs_file', ...at })
    if (i.mode === 'user' && (typeof i.label !== 'string' || !i.label.trim() || i.label.length > LIMITS.label)) issues.push({ code: 'user_needs_label', ...at })
    if (i.mode === 'generated') {
      if (i.slot !== 'start' && i.slot !== 'end') issues.push({ code: 'generated_only_frames', ...at })
      if (typeof i.prompt !== 'string' || !i.prompt.trim() || i.prompt.length > LIMITS.prompt) issues.push({ code: 'generated_needs_prompt', ...at })
      if (i.from != null && !inputs.some((s) => s?.idx === i.from && s.slot === 'source' && s.mode === 'user')) issues.push({ code: 'bad_from', ...at })
    }
    if (i.slot === 'source' && i.mode !== 'user') issues.push({ code: 'source_is_user', ...at })
    if (i.slot === 'source' && !inputs.some((s) => s?.mode === 'generated' && s.from === i.idx)) issues.push({ code: 'source_unused', ...at })
    // Une image créée est toujours obligatoire : la photo dont elle part l'est donc aussi.
    if (i.slot === 'source' && i.mode === 'user' && i.optional) issues.push({ code: 'cannot_be_optional', ...at })
  }
  // Jetons (« @Element2 », « @Image2 ») : comptés dans l'ordre des entrées de chaque famille. Une entrée facultative omise décalerait
  // les suivantes : elle doit donc venir après toutes les entrées obligatoires de sa famille (voir aussi templateFiles, dans l'API).
  const families = {}
  for (const i of [...inputs].filter((x) => x && Number.isInteger(x.idx) && (x.slot === 'element' || x.slot === 'reference')).sort((a, b) => a.idx - b.idx)) {
    const f = (families[i.slot === 'element' ? 'element' : i.kind] ??= [])
    if (!(i.mode === 'user' && i.optional)) for (const o of f) if (!o.flagged) { issues.push({ code: 'optional_not_last', idx: o.idx }); o.flagged = true }
    if (i.mode === 'user' && i.optional) f.push({ idx: i.idx })
  }
  const optionalUser = (slot) => inputs.some((i) => i?.slot === slot && i.mode === 'user' && i.optional)
  const starts = count((i) => i?.slot === 'start')
  const ends = count((i) => i?.slot === 'end')
  if (starts > 1) issues.push({ code: 'one_start' })
  if (ends > 1) issues.push({ code: 'one_end' })
  if (!r.start && starts) issues.push({ code: 'start_unsupported' })
  if (r.start === 'required' && !starts) issues.push({ code: 'start_required' })
  if (r.start === 'required' && optionalUser('start')) issues.push({ code: 'start_required' })
  if (!r.end && ends) issues.push({ code: 'end_unsupported' })
  if (r.end === 'withStart' && ends && (!starts || optionalUser('start'))) issues.push({ code: 'end_needs_start' }) // sans début, la fin serait ignorée
  const elements = count((i) => i?.slot === 'element')
  if (elements > r.elements) issues.push({ code: r.elements ? 'too_many_elements' : 'elements_unsupported' })
  const refs = inputs.filter((i) => i?.slot === 'reference')
  if (refs.length && !r.references) issues.push({ code: 'references_unsupported' })
  if (r.references) for (const k of KINDS) if (refs.filter((i) => i.kind === k).length > r.references[k]) issues.push({ code: 'too_many_references', kind: k })
  // Seedance : les images de début et de fin ne se combinent pas avec des références (elles deviendraient des références).
  if (r.references && refs.length && (starts || ends)) issues.push({ code: 'frames_with_references' })
  const audios = count((i) => i?.slot === 'audio')
  if (audios > 1) issues.push({ code: 'one_audio' })
  if (!r.audio && audios) issues.push({ code: 'audio_unsupported' })
  if (r.audio === 'required' && (!audios || optionalUser('audio'))) issues.push({ code: 'audio_required' })
  return issues
}

/**
 * Entrées d'un modèle enregistré avant les entrées (colonnes `image` et `photo` de `templates`) :
 * - `image` et `photo` : la photo à fournir sert de source, Krea 3 en tire l'image de début ;
 * - `image` seule : l'image de début est créée par Krea 3 à partir du texte ;
 * - `photo` seule : la photo à fournir est elle-même l'image de début (migration 0006 : « ce que l'utilisateur doit fournir comme
 *   image de départ »).
 */
export function legacyInputs({ image, photo }) {
  if (!image) return photo ? [{ idx: 0, slot: 'start', kind: 'image', mode: 'user', label: photo }] : []
  if (!photo) return [{ idx: 0, slot: 'start', kind: 'image', mode: 'generated', prompt: image }]
  return [
    { idx: 0, slot: 'source', kind: 'image', mode: 'user', label: photo },
    { idx: 1, slot: 'start', kind: 'image', mode: 'generated', prompt: image, from: 0 },
  ]
}

/** Ce que l'utilisateur doit fournir (entrées `user`), dans l'ordre. */
export const userInputs = (inputs) => [...(inputs ?? [])].filter((i) => i.mode === 'user').sort((a, b) => a.idx - b.idx)
