import { useEffect, useState } from 'react'
import { VIDEO_MODELS, findModel, videoCost } from '@studio/catalog'
import { findTool, toolCost } from '@studio/catalog/tools'
import { api, apiEnabled } from './api.js'
import { generatedTotal, tplInputs } from './templateRun.js'

/**
 * Vidéos à refaire (Modèles) : une vidéo d'exemple et les réglages du générateur de vidéos qui la reproduisent, servis par l'API
 * (`GET /templates`, depuis D1 ; fichiers dans R2 sous templates/). Lues une fois par visite. Sans API : aucune.
 * Un modèle de vidéo inconnu du catalogue (retiré depuis) écarte la vidéo. Avec `genjutsu` ({ tool, secs, roles }), la vidéo elle-même
 * est la source d'un outil Genjutsu : l'utilisateur n'ajoute qu'une photo par rôle. Sinon `inputs` (voir @studio/catalog/template-slots)
 * dit ce que la vidéo reçoit : fourni par Qreativ, à fournir, ou créé d'abord par Krea 3 ; sans entrées enregistrées, l'équivalent
 * des anciennes colonnes `image` et `photo`.
 */
let loaded = null
/** Une vidéo à refaire avec ses entrées toujours présentes (Genjutsu : aucune). */
export const withInputs = (t) => (t.genjutsu ? t : { ...t, inputs: tplInputs(t) })
const load = () => (loaded ??= apiEnabled
  ? api.templates().then((d) => (d.templates ?? []).map(withInputs)).catch(() => { loaded = null; return [] }) // panne passagère : on réessaiera à la prochaine visite
  : Promise.resolve([]))

/** Toutes les vidéos à refaire publiées (même liste que useTemplates, avant le filtre par modèle) : une promesse, lue une fois. */
export const loadTemplates = () => load()

/** Libellés des catégories connues ; une autre s'affiche telle quelle, avec une majuscule. */
const LABELS = { danse: 'Danse', lifestyle: 'Lifestyle', animaux: 'Animaux', cinema: 'Cinéma', explication: 'Explication', pub: 'Pub', produit: 'Produit', fete: 'Fête', mode: 'Mode', food: 'Cuisine', cuisine: 'Cuisine', immobilier: 'Immobilier', musique: 'Musique', evenement: 'Événement', voyage: 'Voyage' }
export const categoryLabel = (c) => LABELS[c] ?? (c ? c[0].toUpperCase() + c.slice(1) : 'Autres')

/**
 * Coût en cauris d'une vidéo à refaire, avec ses réglages (Genjutsu : en 480p, à la seconde de la source), plus les images que
 * Krea 3 crée d'abord (entrées `generated`).
 */
export function templateCost(t) {
  if (t.genjutsu) return toolCost(findTool(t.genjutsu.tool), { resolution: '480p' }, t.genjutsu.secs)
  const model = findModel(VIDEO_MODELS, t.modelId)
  const secs = t.plans.reduce((n, p) => n + p.dur, 0)
  if (!model) return null // modèle retiré du catalogue : pas de prix
  const video = videoCost(model, secs, model.caps.resolutions ? (t.resolution ?? model.caps.resolutions[0]) : undefined, { sound: t.sound })
  return Math.round((video + generatedTotal(t)) * 10) / 10
}

export function useTemplates(models = VIDEO_MODELS) {
  const [list, setList] = useState([])
  useEffect(() => {
    let alive = true
    load().then((all) => alive && setList(all.filter((t) => (t.genjutsu ? Boolean(findTool(t.genjutsu.tool)) : models.some((m) => m.id === t.modelId)))))
    return () => { alive = false }
  }, [models])
  return list
}
