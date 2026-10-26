import { useEffect, useState } from 'react'
import { VIDEO_MODELS, findModel, videoCost } from '@studio/catalog'
import { api, apiEnabled } from './api.js'

/**
 * Vidéos à refaire (Modèles) : une vidéo d'exemple et les réglages du générateur de vidéos qui la reproduisent, servis par l'API
 * (`GET /templates`, depuis D1 ; fichiers dans R2 sous templates/). Lues une fois par visite. Sans API : aucune.
 * Un modèle de vidéo inconnu du catalogue (retiré depuis) écarte la vidéo.
 */
let loaded = null
const load = () => (loaded ??= apiEnabled
  ? api.templates().then((d) => d.templates ?? []).catch(() => { loaded = null; return [] }) // panne passagère : on réessaiera à la prochaine visite
  : Promise.resolve([]))

/** Libellés des catégories connues ; une autre s'affiche telle quelle, avec une majuscule. */
const LABELS = { animaux: 'Animaux', cinema: 'Cinéma', explication: 'Explication', pub: 'Pub', produit: 'Produit', fete: 'Fête', mode: 'Mode', food: 'Cuisine', cuisine: 'Cuisine', immobilier: 'Immobilier', musique: 'Musique', evenement: 'Événement', voyage: 'Voyage' }
export const categoryLabel = (c) => LABELS[c] ?? (c ? c[0].toUpperCase() + c.slice(1) : 'Autres')

/** Durée totale et coût en cauris d'une vidéo à refaire, avec ses réglages. */
export function templateCost(t) {
  const model = findModel(VIDEO_MODELS, t.modelId)
  const secs = t.plans.reduce((n, p) => n + p.dur, 0)
  return videoCost(model, secs, model.caps.resolutions ? (t.resolution ?? model.caps.resolutions[0]) : undefined, { sound: t.sound })
}

export function useTemplates(models = VIDEO_MODELS) {
  const [list, setList] = useState([])
  useEffect(() => {
    let alive = true
    load().then((all) => alive && setList(all.filter((t) => models.some((m) => m.id === t.modelId))))
    return () => { alive = false }
  }, [models])
  return list
}
