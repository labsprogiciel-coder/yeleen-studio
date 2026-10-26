/**
 * Modèles d'édition d'image chez fal, proposés au choix dans les outils image du studio (voir `editTool` dans tools.js).
 * Chaque outil décrit une demande commune, { prompt, images, ratio, size, count }, et le modèle choisi la traduit pour son point
 * d'accès (`build`) et en donne le coût fournisseur en USD (`usd`), d'après sa page chez fal (octobre 2026).
 *
 * - `ratio` : 'auto' (le format de l'image fournie) ou 'L:H' ; `size` : '1K', '2K' ou '4K' (ramenée à ce que le modèle accepte) ;
 * - `images` : au plus `maxImages` (vérifié par l'outil, voir `editTool`) ;
 * - `count` : nombre d'images ; un modèle sans `multi` n'en produit qu'une par appel et n'est pas proposé pour les variations.
 * Les modèles facturés à la surface reçoivent une taille exacte (largeur × hauteur), calculée ici : le prix est connu avant l'envoi.
 */
const MP = { '1K': 1.05, '2K': 2.1, '4K': 4.2 } // millions de pixels visés pour chaque taille

/** Largeur et hauteur (multiples de 16) d'environ `mp` millions de pixels au format `ratio` ('L:H'). */
export function dims(ratio, mp) {
  const [w, h] = ratio.split(':').map(Number)
  const unit = Math.sqrt((mp * 1e6) / (w * h))
  const r16 = (x) => Math.max(16, Math.floor(x / 16) * 16)
  return { width: r16(w * unit), height: r16(h * unit) }
}
const area = (s) => s.width * s.height / 1e6

/** Taille effective : celle demandée si le modèle l'accepte, sinon la plus grande qu'il accepte. */
export const sizeFor = (model, size) => (model.sizes.includes(size) ? size : model.sizes.at(-1))

// Nano Banana (Pro et 2) : même schéma ; format et résolution nommés, plusieurs images par appel.
const nanoBanana = (r, model) => ({
  prompt: r.prompt, image_urls: r.images, aspect_ratio: r.ratio, resolution: sizeFor(model, r.size), num_images: r.count, output_format: 'png',
})

export const EDIT_MODELS = [
  {
    id: 'krea-3',
    name: 'Krea 3',
    tagline: 'Garde le produit intact : photo produit, porté, matières',
    endpoint: 'krea/v3/edit',
    sizes: ['1K', '2K', '4K'],
    maxImages: 8,
    multi: false,
    // 0,025 $ le mégapixel, sortie comprise et chaque référence (une référence plus grande que la sortie compte à sa taille) :
    // au plus (1 + références) × la surface de sortie. Format « auto » : Krea choisit, jusqu'à 4,22 Mpx ; on compte ce maximum.
    // Raisonnement « medium » (par défaut). Prix provisoire selon fal.
    usd: (r) => 0.025 * (r.ratio === 'auto' ? 4.22 : area(dims(r.ratio, MP[r.size]))) * (1 + r.images.length),
    build: (r) => ({ prompt: r.prompt, image_urls: r.images, image_size: r.ratio === 'auto' ? 'auto' : dims(r.ratio, MP[r.size]), output_format: 'png' }),
  },
  {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    tagline: 'Retouches fidèles et texte lisible, jusqu’en 4K',
    endpoint: 'fal-ai/nano-banana-pro/edit',
    sizes: ['1K', '2K', '4K'],
    maxImages: 8,
    multi: true,
    usd: (r) => (r.size === '4K' ? 0.3 : 0.15) * r.count, // 0,15 $ l'image, 4K au double
    build(r) { return nanoBanana(r, this) },
  },
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    tagline: 'Rapide et deux fois moins cher',
    endpoint: 'fal-ai/nano-banana-2/edit',
    sizes: ['1K', '2K', '4K'],
    maxImages: 8,
    multi: true,
    usd: (r) => 0.08 * { '1K': 1, '2K': 1.5, '4K': 2 }[r.size] * r.count, // 0,08 $ l'image ; 2K ×1,5, 4K ×2
    build(r) { return nanoBanana(r, this) },
  },
  {
    id: 'seedream-5-pro',
    name: 'Seedream 5 Pro',
    tagline: 'Plusieurs références, rendu photo détaillé',
    endpoint: 'bytedance/seedream/v5/pro/edit',
    sizes: ['1K', '2K'],
    maxImages: 8,
    multi: true,
    // 0,0675 $ l'image jusqu'à 1536 × 1536, 0,135 $ au-delà (jusqu'à 2048 × 2048), plus 0,0045 $ par image fournie au-delà de la
    // première (prix provisoire selon fal). Format « auto » : auto_1K ou auto_2K.
    usd(r) {
      const s = sizeFor(this, r.size)
      const big = r.ratio === 'auto' ? s === '2K' : area(dims(r.ratio, MP[s])) > 1536 * 1536 / 1e6
      return ((big ? 0.135 : 0.0675) + 0.0045 * Math.max(0, r.images.length - 1)) * r.count
    },
    build(r) {
      const s = sizeFor(this, r.size)
      return { prompt: r.prompt, image_urls: r.images, image_size: r.ratio === 'auto' ? `auto_${s}` : dims(r.ratio, MP[s]), num_images: r.count, output_format: 'png' }
    },
  },
  {
    id: 'qwen-image-3',
    name: 'Qwen Image 3',
    tagline: 'Le plus économique',
    endpoint: 'alibaba/qwen-image-3/edit',
    sizes: ['1K', '2K'],
    maxImages: 3, // de 1 à 3 images de référence (page du modèle chez fal)
    multi: true,
    // 0,04 $ l'image en 1K, 0,075 $ en 2K. Format « auto » : le modèle choisit la taille, on compte le tarif 2K.
    usd(r) { return (r.ratio !== 'auto' && sizeFor(this, r.size) === '1K' ? 0.04 : 0.075) * r.count },
    build(r) {
      const s = sizeFor(this, r.size)
      return { prompt: r.prompt, image_urls: r.images, ...(r.ratio === 'auto' ? {} : { image_size: dims(r.ratio, MP[s]) }), num_images: r.count, output_format: 'png' }
    },
  },
]

export const findEditModel = (id) => EDIT_MODELS.find((m) => m.id === id) ?? null
