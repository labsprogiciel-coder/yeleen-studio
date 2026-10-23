import { RECIPES } from '@studio/catalog/recipes'
import { PREVIEW } from '../../lib/templatePreviews.js'
import montage from '../../assets/hero/montage.jpg'
import portrait from '../../assets/hero/influenceur.jpg'
import scene from '../../assets/hero/image.jpg'
import pubs from '../../assets/hero/pubs.jpg'

/** Vignette de chaque workflow fal (Modèles). */
export const THUMBS = Object.fromEntries(Object.entries(PREVIEW).map(([id, p]) => [id, p.poster]))

/**
 * Outils de chaque onglet du panneau : l'outil ouvre son formulaire dans le panneau, et la zone principale présente sa visite
 * guidée tant qu'il n'y a pas de création. Seuls des outils qui fonctionnent figurent ici.
 */
export const TOOLS = {
  image: [
    { id: 'image', icon: 'img', title: 'Générateur d’images', desc: 'Créez des images à partir d’un texte' },
  ],
  video: [
    { id: 'video-gen', icon: 'vid', title: 'Générateur vidéo', desc: 'Créez une vidéo à partir d’un texte ou d’une image' },
    { id: 'video-refs', icon: 'layers', title: 'Références et montage', desc: 'Citez images, vidéos et sons ; prolongez ou modifiez une vidéo' },
  ],
  recipe: RECIPES.map((r) => ({ id: r.id, thumb: THUMBS[r.id], title: r.name, desc: r.blurb })),
}
export const TAB_LABEL = { image: 'Image', video: 'Vidéo', recipe: 'Modèles' }
export const toolById = (id) => Object.values(TOOLS).flat().find((t) => t.id === id)
export const tabOf = (id) => Object.keys(TOOLS).find((k) => TOOLS[k].some((t) => t.id === id))

/** Visite guidée de l'outil (zone principale, quand il n'y a encore rien à montrer). */
export const TOURS = {
  'video-gen': [
    { img: scene, title: 'Partez d’une image', text: 'Ajoutez une image de départ (et de fin, si le modèle l’accepte), ou partez du texte seul.' },
    { img: montage, title: 'Décrivez le plan', text: 'Le mouvement, la lumière, ce qui se passe. Ajoutez des plans avec + pour une scène en plusieurs temps.' },
    { img: pubs, title: 'Réglez la durée, le format et le son', text: 'Le prix s’affiche sur le bouton Générer avant de lancer.' },
    { img: portrait, title: 'Retrouvez la vidéo ici', text: 'Elle apparaît dans Créations, puis dans votre bibliothèque.' },
  ],
  'video-refs': [
    { img: portrait, title: 'Joignez vos références', text: 'Images, vidéos et sons, avec + : chacun reçoit un nom, comme « Image 1 ».' },
    { img: montage, title: 'Citez-les dans le texte', text: 'Tapez @ pour placer une référence là où elle compte dans la scène.' },
    { img: pubs, title: 'Prolongez ou modifiez une vidéo', text: 'Avec Seedance 2.5, choisissez Suite ou Modifier la vidéo dans le mode de création.' },
    { img: scene, title: 'Retrouvez le résultat ici', text: 'Il apparaît dans Créations, puis dans votre bibliothèque.' },
  ],
  image: [
    { img: scene, title: 'Décrivez l’image', text: 'Le sujet, le décor, la lumière et le style.' },
    { img: portrait, title: 'Choisissez le modèle et le format', text: 'Nano Banana Pro pour le texte dans l’image, Flux 3 pour le photoréalisme.' },
    { img: pubs, title: 'Générez plusieurs versions', text: 'Jusqu’à quatre images d’un coup, puis gardez la meilleure.' },
    { img: montage, title: 'Animez-la ensuite', text: 'Depuis Créations, envoyez une image vers Vidéo comme image de départ.' },
  ],
}
