import { IMAGE_MODELS, VIDEO_MODELS, findModel } from '@studio/catalog'

/**
 * « Améliorer » : réécrit l'instruction d'une génération (vidéo ou image) pour le modèle choisi, par un modèle de texte chez fal
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
    const m = modelId && findModel(IMAGE_MODELS, modelId)
    return `Image fixe${m ? `, modèle ${m.name}` : ''}.`
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

/** Entrée du point d'accès fal pour réécrire `text`. */
export function enhanceInput({ text, kind, modelId }, model = ENHANCE_MODEL) {
  return {
    model,
    system_prompt: SYSTEM,
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
    .replace(/^(instruction( réécrite)?|prompt|voici[^:]*)\s*:\s*/i, '')
    .replace(/^["«“]\s*|\s*["»”]$/g, '')
    .trim()
  if (!t) return null
  const missing = tokensOf(original).filter((tok) => !t.includes(tok))
  if (missing.length) t = `${t} ${missing.join(' ')}`
  return t.slice(0, MAX_CHARS)
}

/** Jour UTC « AAAA-MM-JJ » du quota. */
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)
