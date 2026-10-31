/**
 * Styles « By Yeleen » : un rendu choisi dans la fenêtre des références (onglet Styles) de Cinéma. Le navigateur n'envoie que
 * l'identifiant (`style`) ; l'API ajoute elle-même la consigne `prompt` au texte envoyé au modèle (voir apps/api/src/inputs.js).
 * Le texte ajouté ne vient donc jamais du navigateur, et un identifiant inconnu n'ajoute rien.
 *
 * Consignes en anglais : les modèles les suivent mieux. Aucune image n'est envoyée au modèle : un style ne coûte rien et ne
 * recopie pas le contenu d'un exemple. Vignette : `templates/styles/<id>.jpg` dans le bucket (déposée à la main), sinon le dégradé.
 */
const grad = (a, b) => `linear-gradient(135deg,${a},${b})`

export const STYLE_CATEGORIES = [
  { id: 'photo', label: 'Photo' },
  { id: 'illustration', label: 'Illustration' },
  { id: '3d', label: '3D' },
]

export const STYLES = [
  { id: 'photo', label: 'Photo réaliste', category: 'photo', poster: grad('#c9a27c', '#3b2a22'),
    prompt: 'photorealistic photography, natural light, true-to-life skin and textures, sharp focus' },
  { id: 'cinema', label: 'Cinéma', category: 'photo', poster: grad('#e0a24a', '#15323a'),
    prompt: 'cinematic film still, anamorphic lens, dramatic lighting, shallow depth of field, subtle film grain, color graded' },
  { id: 'editorial', label: 'Éditorial mode', category: 'photo', poster: grad('#f2e6d8', '#8a3b2e'),
    prompt: 'high-fashion editorial photography, studio flash, bold styling, magazine cover quality' },
  { id: 'vintage', label: 'Vintage 70s', category: 'photo', poster: grad('#d9b779', '#7a4a2b'),
    prompt: '1970s analog film photo, faded warm colors, soft grain, light leaks' },
  { id: 'bw', label: 'Noir et blanc', category: 'photo', poster: grad('#e8e8e4', '#1a1a1a'),
    prompt: 'black and white photography, high contrast, deep blacks, fine grain' },
  { id: 'neon', label: 'Néon', category: 'photo', poster: grad('#18e0c8', '#d12bd9'),
    prompt: 'neon-lit night scene, glowing signs, wet reflections, saturated magenta and cyan' },
  { id: 'anime', label: 'Anime', category: 'illustration', poster: grad('#ff8fb5', '#6a5cff'),
    prompt: 'classic anime style, clean line art, cel shading, expressive eyes, vibrant colors' },
  { id: 'illustration', label: 'Illustration', category: 'illustration', poster: grad('#f4d35e', '#ee6c4d'),
    prompt: 'flat editorial illustration, bold shapes, limited palette, subtle paper texture' },
  { id: 'watercolor', label: 'Aquarelle', category: 'illustration', poster: grad('#bfe3d0', '#e9b8d6'),
    prompt: 'watercolor painting, soft washes, visible paper texture, gentle bleeding edges' },
  { id: 'pop-surreal', label: 'Pop surréalisme', category: 'illustration', poster: grad('#ff9ad5', '#7b5cff'),
    prompt: 'pop surrealism, dreamlike scene, candy pastel colors, glossy surfaces, whimsical details' },
  { id: 'character-3d', label: 'Personnage 3D', category: '3d', poster: grad('#7ac6ff', '#4b3ad6'),
    prompt: 'stylized 3D animated character render, soft global illumination, appealing proportions, animation studio quality' },
  { id: 'clay', label: 'Pâte à modeler', category: '3d', poster: grad('#f0b37e', '#6b8f4e'),
    prompt: 'claymation stop-motion style, handmade plasticine figures, visible fingerprints, miniature set' },
]

export const findStyle = (id) => STYLES.find((s) => s.id === id) ?? null

/** La consigne ajoutée au texte pour l'identifiant reçu ; rien pour un identifiant absent ou inconnu. */
export const styleText = (id) => (typeof id === 'string' ? findStyle(id)?.prompt ?? '' : '')
