import { IMAGE_MODELS, findModel, imageCost } from '@studio/catalog'
import { findTool, toolCost } from '@studio/catalog/tools'
import { legacyInputs, slotTokens } from '@studio/catalog/template-slots'

/**
 * Vidéo à refaire dans Cinéma : ce que l'utilisateur fournit (entrées `user`), ce que Qreativ fournit (`fixed`) et les images que
 * Krea 3 crée d'abord (`generated`). Fonctions pures, sans React : `given` est un objet { [idx]: fichier ou asset } des entrées remplies.
 */

/** Entrées d'une vidéo à refaire, dans l'ordre (`inputs` de l'API, sinon l'équivalent des anciennes colonnes `image` et `photo`). */
export function tplInputs(t) {
  if (!t || t.genjutsu) return []
  const list = Array.isArray(t.inputs) ? t.inputs : legacyInputs({ image: t.image ?? null, photo: t.photo ?? null })
  return [...list].sort((a, b) => a.idx - b.idx)
}

/** Format des images créées par Krea 3 : celui de la vidéo, 16:9 s'il est libre (« auto ») ou absent. */
export const tplRatio = (t) => (t?.ratio && t.ratio !== 'auto' ? t.ratio : '16:9')

/** Coût en cauris d'une image `generated` : retouche d'une photo (avec `from`) ou image du texte seul, en 2K. */
export function generatedCost(input, ratio = '16:9') {
  if (input.from != null) return toolCost(findTool('template-image'), { model: 'krea-3', images: ['fichier'], prompt: input.prompt ?? '', ratio })
  return imageCost(findModel(IMAGE_MODELS, 'krea-3'), '2K', 1)
}

/** Coût total des images à créer d'abord pour une vidéo à refaire. */
export const generatedTotal = (t) => tplInputs(t).filter((i) => i.mode === 'generated').reduce((n, i) => n + generatedCost(i, tplRatio(t)), 0)

const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const KIND = { image: 'image', video: 'vidéo', audio: 'audio' }

/** Nom d'une entrée tel que l'utilisateur le lit (son libellé s'il en a un). */
export function inputTitle(input, inputs = []) {
  if (input.mode === 'user' && input.label) return input.label
  if (input.slot === 'source') {
    const g = inputs.find((i) => i.mode === 'generated' && i.from === input.idx)
    return g?.slot === 'end' ? 'Photo pour l’image de fin' : 'Photo pour l’image de début'
  }
  return { start: 'Image de début', end: 'Image de fin', element: 'Élément', reference: `Référence ${KIND[input.kind]}`, audio: 'Son' }[input.slot] ?? 'Fichier'
}

/** Ce que la bibliothèque propose pour une entrée (selon sa nature). */
export const acceptFor = (input) => `${input.kind}/*`

/** Jeton à citer de chaque entrée ({ [idx]: '@Element1' }), pour la puce de la case. */
export const inputTokens = (inputs) => slotTokens(inputs)

/** Une image `generated` peut-elle être lancée ? Il faut sa consigne et, si elle part d'une photo, cette photo. */
export const canGenerate = (input, given = {}, prompt = input.prompt) => Boolean(prompt?.trim()) && (input.from == null || Boolean(given[input.from]))

/**
 * Ce qui manque pour lancer la vidéo, dans l'ordre des entrées : chaque entrée `user` obligatoire vide (`source` comprise, tant que
 * son image n'est pas faite), chaque image `generated` pas encore créée et chaque entrée facultative dont l'absence décalerait la
 * numérotation des suivantes (`order`, voir `shifts`), et chaque facultative omise que le texte cite (`cited`, avec `token`).
 * [{ idx, why: 'user' | 'generated' | 'order' | 'cited', title, token? }].
 */
export function missingInputs(inputs, given = {}, texts = []) {
  const out = []
  const tokens = slotTokens(inputs)
  const joined = texts.filter((x) => typeof x === 'string').join('\n')
  for (const i of inputs) {
    if (given[i.idx]) continue
    if (i.mode === 'user' && i.optional && tokens[i.idx] && new RegExp(`${tokens[i.idx]}(?!\\d)`).test(joined)) out.push({ idx: i.idx, why: 'cited', token: tokens[i.idx], title: inputTitle(i, inputs) })
    else if (i.mode === 'user' && i.optional && shifts(i, inputs, given)) out.push({ idx: i.idx, why: 'order', title: inputTitle(i, inputs) })
    else if (i.mode === 'user' && !i.optional) {
      if (i.slot === 'source' && inputs.some((g) => g.mode === 'generated' && g.from === i.idx && given[g.idx])) continue // l'image est faite : la photo ne sert plus
      out.push({ idx: i.idx, why: 'user', title: inputTitle(i, inputs) })
    } else if (i.mode === 'generated') out.push({ idx: i.idx, why: 'generated', title: inputTitle(i, inputs) })
  }
  return out
}

/**
 * Une entrée facultative omise décale les jetons des suivantes de sa famille (le serveur ne garde que les fichiers envoyés, dans
 * l'ordre) : « @Image3 » deviendrait « @Image2 ». Tant qu'une entrée plus loin de la même famille part (fixe ou remplie), elle est due.
 */
const family = (i) => (i.slot === 'element' ? 'element' : i.slot === 'reference' ? i.kind : null)
function shifts(input, inputs, given) {
  const f = family(input)
  return Boolean(f) && inputs.some((j) => j.idx > input.idx && family(j) === f && (j.mode === 'fixed' || given[j.idx]))
}

/** La phrase qui dit ce qui manque, ou null. */
export function blockerText(missing) {
  const m = missing[0]
  if (!m) return null
  if (m.why === 'cited') return `Ajoutez : ${lower(m.title)}, ou retirez « ${m.token} » du texte.`
  if (m.why === 'order') return `Ajoutez aussi : ${lower(m.title)} (les entrées suivantes sont numérotées après elle).`
  return m.why === 'generated' ? `Créez d’abord l’${lower(m.title)}.` : `Ajoutez : ${lower(m.title)}.`
}

/**
 * Entrées envoyées avec la vidéo (`templateInputs`) : les `user` et `generated` remplies, sauf les photos `source` (elles ne servent
 * qu'à Krea 3). Les `fixed` sont ajoutées par le serveur. [{ idx, value }] dans l'ordre.
 */
export const sentInputs = (inputs, given = {}) => inputs.filter((i) => i.slot !== 'source' && i.mode !== 'fixed' && given[i.idx]).map((i) => ({ idx: i.idx, value: given[i.idx] }))

/** Ce que l'utilisateur doit faire, d'une phrase (« à fournir » de la vidéo choisie, et le message d'accueil). */
export function todoText(t) {
  if (t.genjutsu) {
    const n = t.genjutsu.roles.length
    return `Ajoutez ${n > 1 ? `une photo par personne (${n})` : t.genjutsu.tool === 'object-swap' ? 'la photo du produit' : 'votre photo'} dans le panneau, puis générez.`
  }
  const inputs = tplInputs(t)
  const asked = inputs.filter((i) => i.mode === 'user').map((i) => `« ${inputTitle(i, inputs)} »${i.optional ? ' (facultatif)' : ''}`)
  const gen = inputs.some((i) => i.mode === 'generated')
  if (!asked.length) return gen ? 'Créez l’image de départ dans le panneau, puis générez.' : 'Ajustez le texte si vous voulez, puis générez.'
  const list = asked.length > 1 ? `${asked.slice(0, -1).join(', ')} et ${asked.at(-1)}` : asked[0]
  return `À ajouter dans le panneau : ${list}${gen ? ' ; créez ensuite l’image' : ''}, puis générez.`
}

/** Identifiant demandé par le lien (`?tpl=<id>`), ou null. */
export const tplParam = (search) => {
  const id = new URLSearchParams(search ?? '').get('tpl')
  return id && /^[a-z0-9-]{1,80}$/i.test(id) ? id : null
}

/** Mot-clé d'une entrée citée dans le texte d'une vidéo à refaire (sans « @ ») : « Element1 », « Image2 », « Video1 », « Audio1 ». */
export const TOKEN_PATTERN = '(?:Element|Image|Video|Audio)\\d+'

/** Entrées qui se citent dans le texte : [{ idx, token: 'Element1', title }], dans l'ordre. */
export function tokenItems(inputs) {
  const tok = slotTokens(inputs)
  return inputs.filter((i) => tok[i.idx]).map((i) => ({ idx: i.idx, token: tok[i.idx].slice(1), title: inputTitle(i, inputs) }))
}
