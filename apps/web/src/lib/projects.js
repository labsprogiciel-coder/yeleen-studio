import { useSyncExternalStore } from 'react'

/**
 * Projets : des dossiers de travail pour ranger ses créations. Chaque génération lancée porte le projet courant (lib/jobs.jsx),
 * et Créations ne montre que celles du projet ouvert. Gardés dans ce navigateur ; le serveur ne les connaît pas encore.
 */
const KEY = 'studio.projects.v1'
const COLORS = ['#d6ff3f', '#ffb547', '#6bb7ff', '#ff7a90', '#7cf0a8', '#c38bff']
export const DEFAULT_PROJECT = 'perso'

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    if (v && Array.isArray(v.list) && v.list.length) return v
  } catch { /* ignoré : on repart du projet par défaut */ }
  return { list: [{ id: DEFAULT_PROJECT, name: 'Projet personnel', color: COLORS[0] }], current: DEFAULT_PROJECT }
}
let state = read()
const subs = new Set()
const write = (next) => {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignoré : le projet reste choisi pour la session */ }
  subs.forEach((f) => f())
}

/** Projet courant (identifiant), lu au moment où une génération est créée. */
export const currentProject = () => state.current

export const selectProject = (id) => { if (state.list.some((p) => p.id === id)) write({ ...state, current: id }) }

/** Crée un projet (« Projet 2 », « Projet 3 »…), l'ouvre et rend son identifiant. */
export function createProject(name) {
  const n = state.list.length + 1
  const id = `p${Date.now().toString(36)}`
  write({ list: [...state.list, { id, name: name?.trim() || `Projet ${n}`, color: COLORS[(n - 1) % COLORS.length] }], current: id })
  return id
}

export function renameProject(id, name) {
  if (!name?.trim()) return
  write({ ...state, list: state.list.map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 40) } : p)) })
}

const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
/** { list, current, project } ; se met à jour à chaque changement. */
export function useProjects() {
  const s = useSyncExternalStore(subscribe, () => state)
  return { list: s.list, current: s.current, project: s.list.find((p) => p.id === s.current) ?? s.list[0] }
}
/** Une génération appartient-elle au projet ? Celles d'avant les projets vont dans le projet par défaut. */
export const inProject = (job, id) => (job.spec?.project ?? DEFAULT_PROJECT) === id
