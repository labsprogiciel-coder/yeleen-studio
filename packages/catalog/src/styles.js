/**
 * Styles « By Yeleen » : un rendu choisi dans la fenêtre des références (onglet Styles) de Cinéma. Le navigateur n'envoie que
 * l'identifiant (`style`) ; l'API ajoute elle-même la consigne `prompt` au texte envoyé au modèle (voir apps/api/src/inputs.js).
 * Le texte ajouté ne vient donc jamais du navigateur, et un identifiant inconnu n'ajoute rien.
 *
 * Consignes en anglais : les modèles les suivent mieux. Aucune image n'est envoyée au modèle : un style ne coûte rien et ne
 * recopie pas le contenu d'un exemple.
 */
const grad = (a, b) => `linear-gradient(135deg,${a},${b})`

export const STYLE_CATEGORIES = [
  { id: 'real', label: 'Réel' },
  { id: 'retro', label: 'Rétro' },
  { id: 'animation', label: 'Animation' },
]

/*
 * Pensés pour la vidéo : des rendus que les modèles vidéo tiennent sur tout un plan (lumière, couleur, grain, technique
 * d'animation), sans dériver d'une image à l'autre. Les styles « image » (aquarelle, illustration à plat…) clignotent ou
 * retombent dans le réalisme en vidéo : ils n'y sont pas. Aperçu : `templates/styles/<id>.jpg` (image) et `<id>.mp4` (boucle de
 * 3 s, sans le son), dans le bucket ; sans eux, le dégradé.
 */
export const STYLES = [
  { id: 'cinema', label: 'Cinéma', category: 'real', poster: grad('#e0a24a', '#15323a'),
    prompt: 'cinematic film look, anamorphic lens, dramatic contrast lighting, shallow depth of field, teal and orange color grade, subtle film grain' },
  { id: 'music-video', label: 'Clip musical', category: 'real', poster: grad('#ff4fd8', '#2b1bff'),
    prompt: 'music video aesthetic, bold colored stage lights, haze, lens flares, dynamic camera moves, high-energy stylish framing' },
  { id: 'tv-ad', label: 'Pub TV', category: 'real', poster: grad('#ffd23f', '#ff5a1f'),
    prompt: 'premium TV commercial look, bright clean lighting, vivid saturated colors, glossy product-shot polish, crisp focus' },
  { id: 'documentary', label: 'Documentaire', category: 'real', poster: grad('#b8a07e', '#3d4a3a'),
    prompt: 'documentary footage, handheld camera, natural available light, authentic real-life moments, muted natural colors' },
  { id: 'neon', label: 'Néon nuit', category: 'real', poster: grad('#18e0c8', '#d12bd9'),
    prompt: 'night scene lit by neon signs, glowing magenta and cyan light, wet reflective streets, deep shadows' },
  { id: 'bw', label: 'Noir et blanc', category: 'retro', poster: grad('#e8e8e4', '#1a1a1a'),
    prompt: 'black and white film, high contrast, deep blacks, silver highlights, fine film grain' },
  { id: 'vintage', label: 'Film 8 mm', category: 'retro', poster: grad('#d9b779', '#7a4a2b'),
    prompt: 'vintage 8mm home movie, warm faded colors, heavy film grain, soft vignette, light leaks, slight frame flicker' },
  { id: 'vhs', label: 'VHS années 90', category: 'retro', poster: grad('#5be3ff', '#8a2be2'),
    prompt: '1990s VHS camcorder footage, scan lines, color bleeding, soft low-resolution image, tracking noise' },
  { id: 'anime', label: 'Anime', category: 'animation', poster: grad('#ff8fb5', '#6a5cff'),
    prompt: 'anime style animation, clean line art, cel shading, vibrant colors, expressive characters' },
  { id: 'character-3d', label: 'Animation 3D', category: 'animation', poster: grad('#7ac6ff', '#4b3ad6'),
    prompt: '3D animated film style, stylized characters, soft global illumination, appealing proportions, animation studio quality' },
  { id: 'clay', label: 'Pâte à modeler', category: 'animation', poster: grad('#f0b37e', '#6b8f4e'),
    prompt: 'claymation stop-motion, handmade plasticine figures and sets, visible fingerprints, slightly choppy stop-motion movement' },
  { id: 'comic', label: 'Bande dessinée', category: 'animation', poster: grad('#ffe14d', '#e63946'),
    prompt: 'animated comic book style, bold ink outlines, halftone dot shading, flat vivid colors' },
]

export const findStyle = (id) => STYLES.find((s) => s.id === id) ?? null

/** La consigne ajoutée au texte pour l'identifiant reçu ; rien pour un identifiant absent ou inconnu. */
export const styleText = (id) => (typeof id === 'string' ? findStyle(id)?.prompt ?? '' : '')
