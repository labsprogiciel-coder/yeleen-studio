import { EXTEND_MODEL, toJetons } from './models.js'
import { VOICES } from './voices.js'

/**
 * Outils du studio Cinéma : un seul point d'accès fal par outil, lancé tel quel (kind 'tool'). Le serveur n'accepte que ceux de
 * cette liste, vérifie chaque entrée et calcule le prix ici ; l'application n'en affiche qu'un aperçu.
 *
 * Entrées (`inputs`) :
 * - `text` : un texte (`required`, `max` caractères) ;
 * - `image`, `video`, `audio` : un fichier déposé chez fal ; `images`, `videos` : une liste, de `min` à `max` fichiers ;
 * - `select` : une valeur parmi `options` ({ id, label, value? } ; `value` est ce que reçoit fal, `id` par défaut) ;
 * - `number` : un nombre entre `min` et `max`.
 * `usd(v)` : coût fournisseur d'un lancement, d'après la page du modèle chez fal ; `build(v)` : l'entrée envoyée à fal.
 * `v` : les entrées vérifiées, choix par défaut compris (voir `toolValues`). `maxP` : résolution maximale d'une vidéo fournie
 * (son plus petit côté : 1080 pour 1080p, en portrait comme en paysage), quand le prix dépend de la résolution de la source.
 *
 * Fichiers vidéo et audio : un outil facturé à la seconde l'est pour `maxSecs`, la durée maximale acceptée. Le serveur mesure
 * chaque fichier au téléversement (apps/api/src/media.js) et refuse, avant le débit, un fichier non mesuré ou hors limites ;
 * l'interface affiche ces limites et refuse le fichier plus tôt.
 */
const opt = (id, label, value) => ({ id, label, ...(value === undefined ? {} : { value }) })
const per = (table) => (key) => table[key]

const VOICE_OPTIONS = VOICES.map((v) => opt(v.id, v.label))

export const TOOLS = [
  // ── Image ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'editor',
    name: 'Éditeur d’images',
    output: 'image',
    endpoint: 'fal-ai/nano-banana-pro/edit', // 0,15 $ l'image ; 4K au double
    inputs: [
      { key: 'images', type: 'images', min: 1, max: 4, label: 'Vos images' },
      { key: 'prompt', type: 'text', required: true, max: 1000, label: 'La modification', placeholder: 'Ex. : remplace le fond par une plage au coucher du soleil' },
      { key: 'resolution', type: 'select', label: 'Résolution', options: [opt('1K', '1K'), opt('2K', '2K'), opt('4K', '4K')] },
    ],
    usd: (v) => (v.resolution === '4K' ? 0.3 : 0.15),
    build: (v) => ({ prompt: v.prompt, image_urls: v.images, resolution: v.resolution, aspect_ratio: 'auto', num_images: 1, output_format: 'png' }),
  },
  {
    id: 'upscaler',
    name: 'Améliorateur d’images',
    output: 'image',
    endpoint: 'fal-ai/seedvr/upscale/image', // 0,001 $ par mégapixel produit
    inputs: [
      { key: 'image', type: 'image', label: 'Image à améliorer' },
      { key: 'target', type: 'select', label: 'Taille', options: [opt('1080p', 'HD'), opt('1440p', '2K'), opt('2160p', '4K')] },
    ],
    // Mégapixels du pire cas (format 21:9, le plus large) pour chaque taille visée.
    usd: (v) => per({ '1080p': 0.0027, '1440p': 0.0048, '2160p': 0.0109 })(v.target),
    build: (v) => ({ image_url: v.image, upscale_mode: 'target', target_resolution: v.target, output_format: 'png' }),
  },
  {
    id: 'cinematic',
    name: 'Plan cinématographique',
    output: 'image',
    endpoint: 'fal-ai/nano-banana-pro', // 0,15 $ l'image
    inputs: [
      { key: 'prompt', type: 'text', required: true, max: 1000, label: 'Le plan', placeholder: 'Ex. : une vendeuse de pagnes au marché de Treichville, à l’aube' },
      { key: 'ratio', type: 'select', label: 'Format', options: [opt('21:9', 'Cinéma 21:9'), opt('16:9', '16:9'), opt('9:16', 'Vertical 9:16')] },
    ],
    usd: () => 0.15,
    build: (v) => ({
      prompt: `${v.prompt}. Cinematic film still, anamorphic lens, dramatic lighting, shallow depth of field, film grain, color graded.`,
      aspect_ratio: v.ratio, resolution: '2K', num_images: 1, output_format: 'png',
    }),
  },
  {
    id: 'variations',
    name: 'Variations',
    output: 'image',
    endpoint: 'fal-ai/nano-banana-pro/edit', // 0,15 $ l'image
    inputs: [
      { key: 'image', type: 'image', label: 'Image de départ' },
      { key: 'prompt', type: 'text', required: false, max: 500, label: 'Ce qui peut changer (facultatif)', placeholder: 'Ex. : la pose et le décor' },
      { key: 'count', type: 'select', label: 'Nombre', options: [opt('2', '2 variations', 2), opt('4', '4 variations', 4)] },
    ],
    usd: (v) => 0.15 * v.count,
    build: (v) => ({
      prompt: `Create a variation of this image: same subject and style, different composition.${v.prompt ? ` Change: ${v.prompt}.` : ''}`,
      image_urls: [v.image], num_images: v.count, aspect_ratio: 'auto', resolution: '1K', output_format: 'png',
    }),
  },
  {
    id: 'skin-enhancer',
    name: 'Améliorateur de peau',
    output: 'image',
    endpoint: 'fal-ai/image-editing/retouch', // 0,04 $ l'image
    inputs: [{ key: 'image', type: 'image', label: 'Portrait à retoucher' }],
    usd: () => 0.04,
    build: (v) => ({ image_url: v.image }),
  },
  {
    id: 'change-camera',
    name: 'Changer de caméra',
    output: 'image',
    endpoint: 'fal-ai/qwen-image-edit-2511-multiple-angles', // 0,035 $ par mégapixel produit
    inputs: [
      { key: 'image', type: 'image', label: 'Image de départ' },
      {
        key: 'angle', type: 'select', label: 'Nouvel angle',
        options: [
          opt('left', '3/4 gauche', { horizontal_angle: 45, vertical_angle: 0, zoom: 5 }),
          opt('right', '3/4 droite', { horizontal_angle: 315, vertical_angle: 0, zoom: 5 }),
          opt('profile', 'Profil', { horizontal_angle: 90, vertical_angle: 0, zoom: 5 }),
          opt('back', 'De dos', { horizontal_angle: 180, vertical_angle: 0, zoom: 5 }),
          opt('high', 'Plongée', { horizontal_angle: 0, vertical_angle: 60, zoom: 5 }),
          opt('low', 'Contre-plongée', { horizontal_angle: 0, vertical_angle: -30, zoom: 5 }),
          opt('wide', 'Plan large', { horizontal_angle: 0, vertical_angle: 0, zoom: 1 }),
          opt('close', 'Gros plan', { horizontal_angle: 0, vertical_angle: 0, zoom: 9 }),
        ],
      },
    ],
    usd: () => 0.07, // 2 mégapixels au plus : à rapprocher de la facture fal
    build: (v) => ({ image_urls: [v.image], ...v.angle, num_images: 1, output_format: 'png' }),
  },
  {
    id: 'mockup-generator',
    name: 'Générateur de maquettes',
    output: 'image',
    endpoint: 'fal-ai/nano-banana-pro/edit', // 0,15 $ l'image
    inputs: [
      { key: 'design', type: 'image', label: 'Votre visuel ou logo' },
      {
        key: 'support', type: 'select', label: 'Support',
        options: [opt('tshirt', 'T-shirt', 'a t-shirt worn by a person'), opt('mug', 'Mug', 'a ceramic mug on a table'), opt('bag', 'Sac', 'a tote bag'), opt('poster', 'Affiche', 'a poster on a city wall'), opt('box', 'Boîte', 'a product box'), opt('phone', 'Téléphone', 'a smartphone screen held in hand')],
      },
      { key: 'prompt', type: 'text', required: false, max: 500, label: 'Le décor (facultatif)', placeholder: 'Ex. : en boutique, lumière naturelle' },
    ],
    usd: () => 0.15,
    build: (v) => ({
      prompt: `Product mockup: place this design on ${v.support}, realistic photo${v.prompt ? `, ${v.prompt}` : ''}. Keep the design exactly as provided.`,
      image_urls: [v.design], num_images: 1, aspect_ratio: '1:1', resolution: '1K', output_format: 'png',
    }),
  },
  {
    id: 'remove-background',
    name: 'Supprimer l’arrière-plan',
    output: 'image',
    endpoint: 'fal-ai/bria/background/remove', // 0,018 $ l'image (sans prompt)
    inputs: [{ key: 'image', type: 'image', label: 'Image à détourer' }],
    usd: () => 0.018,
    build: (v) => ({ image_url: v.image }),
  },
  {
    id: 'relight',
    name: 'Rééclairage',
    output: 'image',
    endpoint: 'fal-ai/image-apps-v2/relighting', // 0,04 $ l'image
    inputs: [
      { key: 'image', type: 'image', label: 'Image à rééclairer' },
      {
        key: 'light', type: 'select', label: 'Lumière',
        options: [opt('natural', 'Naturelle'), opt('studio', 'Studio'), opt('golden_hour', 'Heure dorée'), opt('blue_hour', 'Heure bleue'), opt('dramatic', 'Dramatique'), opt('soft', 'Douce'), opt('backlight', 'Contre-jour'), opt('neon', 'Néon'), opt('candlelight', 'Bougie'), opt('moonlight', 'Clair de lune')],
      },
    ],
    usd: () => 0.04,
    build: (v) => ({ image_url: v.image, lighting_style: v.light }),
  },

  {
    id: 'image-extend',
    name: 'Étendre l’image',
    output: 'image',
    // Nano Banana Pro au format visé : prix fixe. L'outpainting de fal (image-apps-v2/outpaint) est facturé au mégapixel produit,
    // que le serveur ne connaît pas avant l'envoi.
    endpoint: 'fal-ai/nano-banana-pro/edit', // 0,15 $ l'image
    inputs: [
      { key: 'image', type: 'image', label: 'Image à étendre' },
      { key: 'ratio', type: 'select', label: 'Nouveau format', options: [opt('9:16', 'Story 9:16'), opt('4:5', 'Post 4:5'), opt('1:1', 'Carré 1:1'), opt('16:9', 'Paysage 16:9')] },
      { key: 'prompt', type: 'text', required: false, max: 500, label: 'Ce qu’il faut ajouter (facultatif)', placeholder: 'Ex. : prolonger la plage et le ciel' },
    ],
    usd: () => 0.15,
    build: (v) => ({
      prompt: `Outpaint: extend this image to fill the new frame, keeping the original content unchanged and seamless.${v.prompt ? ` ${v.prompt}.` : ''}`,
      image_urls: [v.image], aspect_ratio: v.ratio, resolution: '2K', num_images: 1, output_format: 'png',
    }),
  },
  {
    id: 'photo-restore',
    name: 'Restaurer une photo',
    output: 'image',
    endpoint: 'fal-ai/image-apps-v2/photo-restoration', // 0,04 $ l'image
    inputs: [
      { key: 'image', type: 'image', label: 'Photo ancienne ou abîmée' },
      { key: 'colors', type: 'select', label: 'Couleurs', options: [opt('fix', 'Corriger', true), opt('keep', 'Garder', false)] },
    ],
    usd: () => 0.04,
    build: (v) => ({ image_url: v.image, remove_scratches: true, enhance_resolution: true, fix_colors: v.colors }),
  },
  {
    id: 'product-photo',
    name: 'Photo produit pro',
    output: 'image',
    endpoint: 'fal-ai/nano-banana-pro/edit', // 0,15 $ l'image : détourage, nouveau décor et netteté en un seul passage
    inputs: [
      { key: 'image', type: 'image', label: 'Photo du produit' },
      {
        key: 'scene', type: 'select', label: 'Décor',
        options: [
          opt('studio', 'Studio blanc', 'a clean white studio background with soft shadows'),
          opt('color', 'Fond coloré', 'a solid colour backdrop that matches the product'),
          opt('market', 'Étal de marché', 'a colourful West African market stall'),
          opt('wood', 'Table en bois', 'a wooden table in a bright room, lifestyle photo'),
          opt('outdoor', 'Extérieur', 'an outdoor setting in natural daylight'),
        ],
      },
      { key: 'prompt', type: 'text', required: false, max: 500, label: 'Détails (facultatif)', placeholder: 'Ex. : avec des feuilles de bananier' },
      { key: 'ratio', type: 'select', label: 'Format', options: [opt('1:1', 'Carré 1:1'), opt('4:5', 'Post 4:5'), opt('9:16', 'Story 9:16')] },
    ],
    usd: () => 0.15,
    build: (v) => ({
      prompt: `Professional product photo: cut out the product exactly as it is and place it on ${v.scene}${v.prompt ? `, ${v.prompt}` : ''}. Sharp focus, realistic lighting and shadows, e-commerce quality. Do not change the product.`,
      image_urls: [v.image], aspect_ratio: v.ratio, resolution: '2K', num_images: 1, output_format: 'png',
    }),
  },

  // ── Vidéo ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'clip-editor',
    name: 'Éditeur de clips',
    output: 'video',
    endpoint: 'fal-ai/workflow-utilities/trim-video', // facturé au temps de calcul (prix non affiché par fal) : PROVISOIRE
    inputs: [
      { key: 'video', type: 'video', label: 'Clip à couper' },
      { key: 'start', type: 'number', min: 0, max: 600, step: 0.1, label: 'Début (s)' },
      { key: 'end', type: 'number', min: 0.1, max: 600, step: 0.1, label: 'Fin (s)' },
    ],
    check: (v) => (v.end > v.start ? null : 'invalid_range'),
    usd: () => 0.005,
    build: (v) => ({ video_url: v.video, start_time: v.start, end_time: v.end }),
  },
  {
    id: 'video-upscaler',
    name: 'Améliorateur de vidéos',
    output: 'video',
    endpoint: 'fal-ai/bytedance-upscaler/upscale/video', // à la seconde, 30 i/s, niveau « standard »
    maxSecs: 30,
    inputs: [
      { key: 'video', type: 'video', label: 'Vidéo à améliorer' },
      { key: 'target', type: 'select', label: 'Taille', options: [opt('1080p', '1080p'), opt('2k', '2K'), opt('4k', '4K')] },
    ],
    usd: (v) => per({ '1080p': 0.0072, '2k': 0.0144, '4k': 0.0288 })(v.target) * 30,
    build: (v) => ({ video_url: v.video, target_resolution: v.target, target_fps: 30, enhancement_tier: 'standard' }),
  },
  {
    id: 'video-relight',
    name: 'Rééclairage vidéo',
    output: 'video',
    endpoint: 'minimax/h3-max/relight', // à la seconde de vidéo produite (la durée de la source)
    maxSecs: 10,
    inputs: [
      { key: 'video', type: 'video', label: 'Vidéo à rééclairer' },
      { key: 'reference', type: 'image', label: 'Image d’ambiance (la lumière à reprendre)' },
      { key: 'resolution', type: 'select', label: 'Résolution', options: [opt('480P', '480p'), opt('768P', '768p')] },
    ],
    usd: (v) => per({ '480P': 0.05, '768P': 0.08 })(v.resolution) * 10,
    build: (v) => ({ video_url: v.video, reference_image_url: v.reference, resolution: v.resolution, aspect_ratio: 'adaptive' }),
  },
  {
    id: 'video-project-editor',
    name: 'Éditeur de projet vidéo',
    output: 'video',
    endpoint: 'fal-ai/ffmpeg-api/merge-videos', // facturé au temps de calcul (prix non affiché par fal) : PROVISOIRE
    inputs: [{ key: 'videos', type: 'videos', min: 2, max: 6, label: 'Vos clips, dans l’ordre' }],
    usd: () => 0.01,
    build: (v) => ({ video_urls: v.videos, resolution_aspect_ratio_video_index: 0 }),
  },
  {
    id: 'video-extend',
    name: 'Prolonger la vidéo',
    output: 'video',
    endpoint: EXTEND_MODEL.endpoint, // à la seconde générée
    inputs: [
      { key: 'video', type: 'video', label: 'Clip à prolonger' },
      { key: 'prompt', type: 'text', required: false, max: 1000, label: 'La suite (facultatif)', placeholder: 'Ex. : elle se retourne et s’éloigne' },
      { key: 'mode', type: 'select', label: 'Où', options: [opt('end', 'Après la fin'), opt('start', 'Avant le début')] },
      { key: 'duration', type: 'select', label: 'Durée ajoutée', options: [opt('5', '5 s', 5), opt('10', '10 s', 10), opt('20', '20 s', 20)] },
    ],
    usd: (v) => EXTEND_MODEL.price.usd * v.duration,
    build: (v) => ({ video_url: v.video, mode: v.mode, duration: v.duration, ...(v.prompt ? { prompt: v.prompt } : {}) }),
  },
  {
    id: 'video-fps',
    name: 'Fluidifier la vidéo',
    output: 'video',
    // Topaz facture les images créées : ≈ 0,001 $ l'image en 1080p, 0,002 $ en 4K. Pire cas : 10 s, source à 24 i/s, tarif 4K.
    endpoint: 'topaz/interpolate/video',
    maxSecs: 10,
    inputs: [
      { key: 'video', type: 'video', label: 'Vidéo à fluidifier' },
      { key: 'fps', type: 'select', label: 'Images par seconde', options: [opt('60', '60 i/s', 60), opt('120', '120 i/s', 120)] },
    ],
    usd: (v) => (v.fps - 24) * 10 * 0.002,
    build: (v) => ({ video_url: v.video, target_fps: v.fps, model: 'Apollo', H264_output: true }),
  },
  {
    id: 'video-hdr',
    name: 'SDR vers HDR',
    output: 'video',
    // 2,40 $ pour 10 s jusqu'en 1080p à 30 i/s (4K : 5,10 $) : la source est limitée à 10 s et à 1080p.
    endpoint: 'topaz/sdr-to-hdr/video',
    maxSecs: 10,
    maxP: 1080,
    inputs: [{ key: 'video', type: 'video', label: 'Vidéo SDR' }],
    usd: () => 2.4,
    build: (v) => ({ video_url: v.video, output_format: 'mp4' }),
  },
  {
    id: 'video-remove-bg',
    name: 'Supprimer l’arrière-plan vidéo',
    output: 'video',
    endpoint: 'veed/video-background-removal', // 0,0225 $ les 30 images (bords affinés) ; pire cas : 20 s à 60 i/s
    maxSecs: 20,
    inputs: [
      { key: 'video', type: 'video', label: 'Vidéo à détourer' },
      { key: 'subject', type: 'select', label: 'Sujet', options: [opt('person', 'Une personne', true), opt('object', 'Un objet', false)] },
    ],
    usd: () => 0.0225 * 2 * 20,
    build: (v) => ({ video_url: v.video, subject_is_person: v.subject, refine_foreground_edges: true, output_codec: 'vp9' }),
  },
  {
    id: 'video-reframe',
    name: 'Recadrer la vidéo',
    output: 'video',
    endpoint: 'fal-ai/ltx-2.3/reframe', // à la seconde de la source : 0,10 $ en 720p, 0,20 $ en 1080p
    maxSecs: 10,
    inputs: [
      { key: 'video', type: 'video', label: 'Vidéo à recadrer' },
      { key: 'ratio', type: 'select', label: 'Nouveau format', options: [opt('9:16', 'Story 9:16'), opt('1:1', 'Carré 1:1'), opt('4:5', 'Post 4:5'), opt('16:9', 'Paysage 16:9')] },
      { key: 'resolution', type: 'select', label: 'Résolution', options: [opt('720p', '720p'), opt('1080p', '1080p')] },
    ],
    usd: (v) => per({ '720p': 0.1, '1080p': 0.2 })(v.resolution) * 10,
    build: (v) => ({ video_url: v.video, aspect_ratio: v.ratio, resolution: v.resolution }),
  },
  {
    id: 'video-depth',
    name: 'Carte de profondeur',
    output: 'video',
    endpoint: 'fal-ai/depth-anything-video', // 0,04 $ la seconde
    maxSecs: 20,
    inputs: [
      { key: 'video', type: 'video', label: 'Vidéo à analyser' },
      { key: 'colormap', type: 'select', label: 'Rendu', options: [opt('grayscale', 'Niveaux de gris'), opt('turbo', 'Couleurs')] },
    ],
    usd: () => 0.04 * 20,
    build: (v) => ({ video_url: v.video, colormap: v.colormap }),
  },
  {
    id: 'speak-text',
    name: 'Parler',
    output: 'video',
    endpoint: 'veed/fabric-1.0/text', // à la seconde produite : 0,08 $ en 480p, 0,15 $ en 720p
    inputs: [
      { key: 'image', type: 'image', label: 'Visage' },
      { key: 'text', type: 'text', required: true, max: 400, label: 'Texte à dire', placeholder: 'Ce que la personne dit, mot pour mot' },
      { key: 'voice', type: 'text', required: false, max: 200, label: 'La voix (facultatif)', placeholder: 'Ex. : voix de femme, chaleureuse, accent ivoirien' },
      { key: 'resolution', type: 'select', label: 'Résolution', options: [opt('480p', '480p'), opt('720p', '720p')] },
    ],
    // Durée de la parole : 10 caractères par seconde au plus lent, arrondie à la seconde supérieure.
    usd: (v) => Math.ceil(v.text.length / 10) * per({ '480p': 0.08, '720p': 0.15 })(v.resolution),
    build: (v) => ({ image_url: v.image, text: v.text, resolution: v.resolution, ...(v.voice ? { voice_description: v.voice } : {}) }),
  },
  {
    id: 'speak-audio',
    name: 'Parler',
    output: 'video',
    endpoint: 'veed/fabric-1.0', // à la seconde produite (la durée de l'audio)
    maxSecs: 30,
    inputs: [
      { key: 'image', type: 'image', label: 'Visage' },
      { key: 'audio', type: 'audio', label: 'Audio de la voix' },
      { key: 'resolution', type: 'select', label: 'Résolution', options: [opt('480p', '480p'), opt('720p', '720p')] },
    ],
    usd: (v) => per({ '480p': 0.08, '720p': 0.15 })(v.resolution) * 30,
    build: (v) => ({ image_url: v.image, audio_url: v.audio, resolution: v.resolution }),
  },

  // ── Audio ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'music-generator',
    name: 'Générateur de musique',
    output: 'audio',
    endpoint: 'fal-ai/elevenlabs/music', // 0,6 $ la minute produite, arrondie à la minute supérieure
    inputs: [
      { key: 'prompt', type: 'text', required: true, max: 1000, label: 'La musique', placeholder: 'Ex. : afrobeat entraînant, percussions et cuivres festifs' },
      { key: 'length', type: 'select', label: 'Durée', options: [opt('30', '30 s', 30), opt('60', '1 min', 60), opt('120', '2 min', 120)] },
      { key: 'vocals', type: 'select', label: 'Voix', options: [opt('instrumental', 'Instrumental', true), opt('vocals', 'Avec voix', false)] },
    ],
    usd: (v) => Math.ceil(v.length / 60) * 0.6,
    build: (v) => ({ prompt: v.prompt, music_length_ms: v.length * 1000, force_instrumental: v.vocals }),
  },
  {
    id: 'audio-generator',
    name: 'Générateur audio',
    output: 'audio',
    endpoint: 'fal-ai/stable-audio-25/text-to-audio', // 0,2 $ l'audio
    inputs: [
      { key: 'prompt', type: 'text', required: true, max: 1000, label: 'L’ambiance', placeholder: 'Ex. : marché animé, voix lointaines, klaxons' },
      { key: 'length', type: 'select', label: 'Durée', options: [opt('10', '10 s', 10), opt('30', '30 s', 30), opt('60', '1 min', 60), opt('120', '2 min', 120)] },
    ],
    usd: () => 0.2,
    build: (v) => ({ prompt: v.prompt, seconds_total: v.length }),
  },
  {
    id: 'sound-effect-generator',
    name: 'Générateur d’effets sonores',
    output: 'audio',
    endpoint: 'fal-ai/elevenlabs/sound-effects/v2', // 0,002 $ la seconde
    inputs: [
      { key: 'prompt', type: 'text', required: true, max: 500, label: 'L’effet', placeholder: 'Ex. : porte métallique qui grince' },
      { key: 'length', type: 'select', label: 'Durée', options: [opt('3', '3 s', 3), opt('5', '5 s', 5), opt('10', '10 s', 10), opt('20', '20 s', 20)] },
    ],
    usd: (v) => 0.002 * v.length,
    build: (v) => ({ text: v.prompt, duration_seconds: v.length }),
  },
  {
    id: 'voice-changer',
    name: 'Changeur de voix',
    output: 'audio',
    endpoint: 'fal-ai/elevenlabs/voice-changer', // 0,3 $ la minute
    maxSecs: 60,
    inputs: [
      { key: 'audio', type: 'audio', label: 'Audio à transformer' },
      { key: 'voice', type: 'select', label: 'Voix', options: VOICE_OPTIONS },
    ],
    usd: () => 0.3,
    build: (v) => ({ audio_url: v.audio, voice: v.voice }),
  },
  {
    id: 'audio-isolation',
    name: 'Isolation audio',
    output: 'audio',
    endpoint: 'fal-ai/elevenlabs/audio-isolation', // 0,1 $ la minute
    maxSecs: 120,
    inputs: [{ key: 'audio', type: 'audio', label: 'Audio avec voix et bruit' }],
    usd: () => 0.2,
    build: (v) => ({ audio_url: v.audio }),
  },
]

export const findTool = (id) => TOOLS.find((t) => t.id === id)
const FILE_TYPES = ['image', 'video', 'audio']
const LIST_TYPES = ['images', 'videos']
export const isFileField = (f) => FILE_TYPES.includes(f.type) || LIST_TYPES.includes(f.type)

/** Ce qui ne va pas dans les entrées d'un outil (un code, ou null). `isFile` dit si une valeur de fichier est acceptée. */
export function toolInputIssue(tool, inputs = {}, isFile = (v) => typeof v === 'string' && v.length > 0) {
  for (const f of tool.inputs) {
    const v = inputs[f.key]
    if (f.type === 'text') {
      if (v != null && (typeof v !== 'string' || v.length > f.max)) return `invalid_${f.key}`
      if (f.required && !v?.trim()) return `missing_${f.key}`
    } else if (FILE_TYPES.includes(f.type)) {
      if (!isFile(v)) return `missing_${f.key}`
    } else if (LIST_TYPES.includes(f.type)) {
      if (!Array.isArray(v) || v.length < f.min || v.length > f.max || !v.every(isFile)) return `missing_${f.key}`
    } else if (f.type === 'select') {
      if (v != null && !f.options.some((o) => o.id === v)) return `invalid_${f.key}`
    } else if (f.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < f.min || v > f.max) return `invalid_${f.key}`
    }
  }
  return null
}

/** Les entrées vérifiées, prêtes pour `usd` et `build` : textes nettoyés, choix traduits (le premier par défaut). */
export function toolValues(tool, inputs = {}) {
  const v = {}
  for (const f of tool.inputs) {
    const x = inputs[f.key]
    if (f.type === 'text') v[f.key] = (x ?? '').trim()
    else if (f.type === 'select') {
      const o = f.options.find((o) => o.id === x) ?? f.options[0]
      v[f.key] = o.value === undefined ? o.id : o.value
    } else v[f.key] = x
  }
  return v
}

/** Ce qui ne va pas (code), une fois chaque entrée valide : règles entre plusieurs champs (ex. début avant fin). */
export const toolCheck = (tool, inputs) => tool.check?.(toolValues(tool, inputs)) ?? null
export const toolCost = (tool, inputs = {}) => toJetons(tool.usd(toolValues(tool, inputs)))
export const toolInput = (tool, inputs = {}) => tool.build(toolValues(tool, inputs))
