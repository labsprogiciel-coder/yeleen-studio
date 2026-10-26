import { IMAGE_MODELS, VIDEO_MODELS, findModel } from '@studio/catalog'
import { findEditModel } from '@studio/catalog/edit-models'
import { findWorkflow } from '@studio/catalog/workflows'

/**
 * « Améliorer » : réécrit l'instruction d'une génération (vidéo ou image) pour le modèle choisi, ou écrit le script d'une voix off
 * à partir d'une idée (`kind: 'voice'`), précise un texte d'un modèle de la page Modèles (`kind: 'template'`) ou une retouche
 * d'image (`kind: 'edit'`, outils image), ou découpe une idée en plans pour un modèle vidéo multi-plans (`kind: 'shots'`, mode Auto),
 * par un modèle de texte chez fal
 * (point d'accès `openrouter/router`, modèle réglable par ENHANCE_MODEL). Gratuit, avec un quota par jour et par compte.
 * Les références « @mot » de l'utilisateur doivent survivre telles quelles : sans elles, la génération perdrait ses images.
 */
export const ENHANCE_ENDPOINT = 'openrouter/router'
export const ENHANCE_MODEL = 'google/gemini-2.5-flash'
export const MIN_CHARS = 3
export const MAX_CHARS = 2000

const TOKEN = /@[\p{L}\p{N}_-]+/gu
export const tokensOf = (text) => [...new Set(text.match(TOKEN) ?? [])]

/** Ce que l'on sait du modèle visé, en une ligne pour le modèle de texte. */
function modelLine(kind, modelId) {
  if (kind === 'image') {
    const m = IMAGE_MODELS.find((x) => x.id === modelId)
    return `Image fixe${m ? `, modèle ${m.name}` : ''}.`
  }
  if (kind === 'edit') {
    const m = findEditModel(modelId)
    return `Retouche d'une image existante${m ? `, modèle ${m.name}` : ''}.`
  }
  const m = modelId && findModel(VIDEO_MODELS, modelId)
  if (!m) return 'Vidéo courte.'
  const d = m.caps?.duration
  const max = d?.max ?? (d?.values ? Math.max(...d.values) : null)
  const sound = m.caps?.audio && m.caps.audio !== 'none' ? ', avec le son (décrire aussi les sons et les voix)' : ''
  return `Vidéo, modèle ${m.name}${max ? `, ${max} s au plus par plan` : ''}${sound}.`
}

const SYSTEM = `Tu réécris l'instruction d'un utilisateur pour un modèle de génération d'images ou de vidéos.
Règles :
- Garde la langue de l'utilisateur (français par défaut) et son idée : ne change ni le sujet, ni l'action, ni le lieu.
- Précise ce qui manque : sujet, décor, lumière, cadrage, mouvement de caméra (vidéo), ambiance, style.
- Recopie à l'identique chaque mot commençant par @ (ce sont des références à des fichiers).
- Une seule instruction, 40 à 90 mots, en texte continu : pas de titre, pas de liste, pas de guillemets, pas de commentaire.
- Décris uniquement ce qui doit être vu ou entendu.`

// Voix off : un texte prêt à être lu, d'environ 20 à 30 secondes (le rythme d'une voix off est d'environ 2,5 mots par seconde).
const SYSTEM_VOICE = `Tu écris le texte d'une voix off publicitaire ou explicative à partir de l'idée d'un utilisateur.
Règles :
- Écris dans la langue demandée ; sinon dans celle de l'utilisateur (français par défaut).
- Garde son idée et ses informations exactes (produit, offre, prix, lieu, contact) ; n'invente ni prix, ni adresse, ni numéro.
- Un texte parlé, naturel et chaleureux : phrases courtes, une accroche au début, un appel à l'action à la fin s'il y a une offre.
- 50 à 80 mots, en texte continu : pas de titre, pas de liste, pas de guillemets, pas d'indication de ton ou de musique entre crochets, pas d'emoji.
- Écris uniquement ce que la voix doit dire.`
const LANG_NAMES = { fr: 'français', en: 'anglais', es: 'espagnol', pt: 'portugais', de: 'allemand', ar: 'arabe' }

// Modèles (workflows) : chaque texte a son rôle (une météo, un sujet, une idée de logo) ; la réponse garde la forme de son exemple.
const SYSTEM_TEMPLATE = `Tu précises le texte qu'un utilisateur a saisi dans un champ d'un modèle de génération (image ou vidéo).
Règles :
- Garde la langue de l'utilisateur (français par défaut), son idée et le rôle du champ : ne réponds qu'à ce que le champ demande.
- Ajoute des détails visuels utiles (matières, couleurs, lumière, ambiance), sans changer le sujet.
- Respecte la longueur demandée : une expression courte reste une expression courte.
- Recopie à l'identique chaque mot commençant par @.
- Texte continu : pas de titre, pas de liste, pas de guillemets, pas de commentaire.`

// Découpage en plans (Kling 3.0) : une réponse JSON, une instruction et une durée par plan, dans la durée totale du modèle.
const SYSTEM_SHOTS = `Tu découpes l'idée d'un utilisateur en plans successifs pour un modèle de génération vidéo multi-plans.
Règles :
- Garde la langue de l'utilisateur (français par défaut) et son idée : même sujet, mêmes personnages, même lieu, une histoire qui se suit.
- 2 à 4 plans. Chaque plan : une instruction autonome de 25 à 60 mots (sujet, action, cadrage, mouvement de caméra, lumière, sons) et une durée en secondes.
- Recopie à l'identique chaque mot commençant par @ (des références à des fichiers) dans les plans où ils apparaissent.
- Réponds uniquement par un tableau JSON, sans texte autour : [{"text": "…", "dur": 5}, …]`

export const MAX_SHOTS = 4
export const SHOT_DURS = [2, 3, 5, 8, 10] // les durées d'un plan proposées par l'éditeur (DURATIONS de apps/web/src/lib/useGenSettings.js)

/** Le modèle vidéo multi-plans visé par un découpage, ou null. */
export function shotModel(modelId) {
  const m = modelId && findModel(VIDEO_MODELS, modelId)
  return m?.caps?.multiShot ? m : null
}

/**
 * Plans tirés de la réponse : le tableau JSON (même entouré de texte ou de ```), au plus MAX_SHOTS plans non vides, chaque durée
 * ramenée à SHOT_DURS, puis raccourcie (la plus longue d'abord) jusqu'à tenir dans la durée maximale du modèle. Les références « @mot »
 * absentes de tous les plans sont rajoutées au premier. Rend null si la réponse ne donne pas au moins 2 plans.
 */
export function parseShots(output, original, model) {
  const raw = String(output ?? '')
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end < start) return null
  let list
  try { list = JSON.parse(raw.slice(start, end + 1)) } catch { return null }
  if (!Array.isArray(list)) return null
  const snap = (d) => SHOT_DURS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a))
  let plans = list
    .map((p) => ({ text: typeof p?.text === 'string' ? cleanOutput(p.text, '') : null, dur: snap(Number(p?.dur) || 5) }))
    .filter((p) => p.text)
    .slice(0, MAX_SHOTS)
  const max = model.caps.duration.max
  for (;;) {
    const total = plans.reduce((n, p) => n + p.dur, 0)
    if (total <= max) break
    const longest = plans.reduce((a, p) => (p.dur > a.dur ? p : a))
    if (longest.dur === SHOT_DURS[0]) plans = plans.slice(0, -1) // tous au plus court : un plan de moins
    else longest.dur = SHOT_DURS[SHOT_DURS.indexOf(longest.dur) - 1]
  }
  if (plans.length < 2) return null
  const kept = new Set(plans.flatMap((p) => tokensOf(p.text)))
  const missing = tokensOf(original).filter((t) => !kept.has(t))
  if (missing.length) plans[0].text = cleanOutput(plans[0].text, `${plans[0].text} ${missing.join(' ')}`)
  return plans
}

// Retouche (outils image : éditeur, photo produit, maquettes…) : l'instruction dit ce qui change dans une image fournie, pas une scène.
const SYSTEM_EDIT = `Tu précises l'instruction de retouche qu'un utilisateur donne à un modèle d'édition d'image, sur une image qu'il fournit.
Règles :
- Garde la langue de l'utilisateur (français par défaut) et son intention : ne change ni ce qu'il veut modifier, ni le sujet.
- Dis clairement ce qui change (décor, lumière, couleurs, matières, cadrage) et ce qui doit rester identique (le sujet, le produit, son texte et ses couleurs).
- Ne décris pas l'image d'origine que tu ne vois pas ; n'invente ni marque, ni texte à écrire.
- Recopie à l'identique chaque mot commençant par @.
- Une seule instruction, 20 à 60 mots, en texte continu : pas de titre, pas de liste, pas de guillemets, pas de commentaire.`

/** Le champ texte d'un workflow que « Améliorer » peut préciser, ou null (inconnu, pas un texte, ou `enhance: false`). */
export function templateField(workflowId, key) {
  const f = findWorkflow(workflowId)?.inputs.find((x) => x.key === key)
  return f && f.type === 'text' && f.enhance !== false ? f : null
}

/** Entrée du point d'accès fal : réécrire `text` (vidéo, image), en tirer un script de voix off (voice) ou des plans (shots), ou préciser le texte d'un modèle (template). */
export function enhanceInput({ text, kind, modelId, language, workflowId, field }, model = ENHANCE_MODEL) {
  if (kind === 'shots') {
    const m = shotModel(modelId)
    if (!m) return null
    const sound = m.caps.audio && m.caps.audio !== 'none' ? ', avec le son' : ''
    return {
      model,
      system_prompt: SYSTEM_SHOTS,
      prompt: `Modèle ${m.name}${sound}. Durées possibles d'un plan : ${SHOT_DURS.join(', ')} s ; ${m.caps.duration.max} s au plus en tout.\nIdée à découper :\n${text}`,
      temperature: 0.7,
      max_tokens: 900,
    }
  }
  if (kind === 'template') {
    const w = findWorkflow(workflowId)
    const f = templateField(workflowId, field)
    if (!f) return null
    const short = (f.example ?? '').split(/\s+/).filter(Boolean).length <= 8
    const size = short ? 'une expression courte de 3 à 15 mots' : '1 à 3 phrases, 20 à 60 mots'
    return {
      model,
      system_prompt: SYSTEM_TEMPLATE,
      prompt: `Modèle « ${w.name} » : ${w.blurb}.\nChamp « ${f.label} »${f.example ? `, exemple : ${f.example}` : ''}.\nLongueur : ${size}.\nTexte à préciser :\n${text}`,
      temperature: 0.7,
      max_tokens: 300,
    }
  }
  if (kind === 'voice') {
    const lang = LANG_NAMES[language]
    return {
      model,
      system_prompt: SYSTEM_VOICE,
      prompt: `Voix off d'environ 20 à 30 secondes${lang ? `, en ${lang}` : ''}.\nIdée de l'utilisateur :\n${text}`,
      temperature: 0.8,
      max_tokens: 500,
    }
  }
  return {
    model,
    system_prompt: kind === 'edit' ? SYSTEM_EDIT : SYSTEM,
    prompt: `${modelLine(kind, modelId)}\nInstruction à réécrire :\n${text}`,
    temperature: 0.7,
    max_tokens: 400,
  }
}

/**
 * Texte final : sans guillemets ni préfixe ajoutés par le modèle ; les références « @mot » oubliées sont rajoutées à la fin.
 * Rend null si la réponse est vide.
 */
export function cleanOutput(output, original) {
  let t = String(output ?? '').trim()
    .replace(/^(instruction( réécrite)?|prompt|script|texte|voix off|voici[^:]*)\s*:\s*/i, '')
    .replace(/^["«“]\s*|\s*["»”]$/g, '')
    .trim()
  if (!t) return null
  const wanted = tokensOf(original)
  let body = t.slice(0, MAX_CHARS)
  for (;;) {
    const kept = tokensOf(body)
    const suffix = wanted.filter((tok) => !kept.includes(tok)).join(' ')
    if (!suffix) return body
    if (body.length + 1 + suffix.length <= MAX_CHARS) return `${body} ${suffix}`
    body = body.slice(0, MAX_CHARS - 1 - suffix.length).trimEnd() // place gardée pour les références, recomptées au tour suivant
  }
}

/** Jour UTC « AAAA-MM-JJ » du quota. */
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)
