import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAUNCH_WINDOW_MS, createLaunchGuard, launchKey, launched } from '../src/lib/launchGuard.js'

const file = (name, size = 10, lastModified = 1) => ({ name, size, type: 'image/jpeg', lastModified, arrayBuffer() {} })
const spec = (over = {}) => ({ kind: 'video', title: 'Seedance 2.5', prompt: 'Une vendeuse de bissap', cost: 41.4, live: { kind: 'video', modelId: 'seedance', plans: [{ text: 'a', dur: 5 }] }, ...over })

test('identité : la même demande donne la même clé, quel que soit l’ordre des champs et sans compter les valeurs absentes', () => {
  assert.equal(launchKey(spec()), launchKey(spec()))
  assert.equal(launchKey({ a: 1, b: { c: 2, d: undefined } }), launchKey({ b: { c: 2 }, a: 1 }))
})

test('identité : un texte, un prix, une option ou un fichier différent font une autre demande', () => {
  const k = launchKey(spec())
  assert.notEqual(launchKey(spec({ prompt: 'Une vendeuse de bissap.' })), k)
  assert.notEqual(launchKey(spec({ cost: 40 })), k)
  assert.notEqual(launchKey(spec({ live: { kind: 'video', modelId: 'kling', plans: [{ text: 'a', dur: 5 }] } })), k)
  const a = launchKey(spec({ live: { kind: 'tool', inputFiles: { images: [file('a.jpg')] } } }))
  assert.equal(a, launchKey(spec({ live: { kind: 'tool', inputFiles: { images: [file('a.jpg')] } } }))) // même fichier relu : même demande
  assert.notEqual(a, launchKey(spec({ live: { kind: 'tool', inputFiles: { images: [file('b.jpg')] } } })))
  assert.notEqual(a, launchKey(spec({ live: { kind: 'tool', inputFiles: { images: [file('a.jpg', 11)] } } })))
})

test('identité : un fichier relu depuis la bibliothèque (nouvelle date à chaque lecture) reste le même fichier', () => {
  const k = (f) => launchKey(spec({ live: { kind: 'video', references: [{ kind: 'image', file: f }] } }))
  assert.equal(k(file('ref.png', 10, 1000)), k(file('ref.png', 10, 1030)))
  assert.equal(k(new File(['abc'], 'ref.png', { type: 'image/png', lastModified: 1 })), k(new File(['abc'], 'ref.png', { type: 'image/png', lastModified: 2 })))
  assert.notEqual(k(new File(['abc'], 'ref.png', { type: 'image/png' })), k(new File(['abcd'], 'ref.png', { type: 'image/png' })))
})

test('identité : ce qui ne se décrit pas sûrement n’a pas de clé ; un objet ordinaire garde tous ses champs', () => {
  const k = (v) => launchKey(spec({ live: { v } }))
  assert.equal(k(new Blob(['abc'], { type: 'image/png' })), null) // fichier sans nom : deux contenus différents se confondraient
  assert.equal(k(new Map([['a', 1]])), null)
  assert.equal(k(new Set([1])), null)
  assert.notEqual(k({ name: 'a', size: 1, type: 'image', id: 1 }), k({ name: 'a', size: 1, type: 'image', id: 2 })) // pas un fichier
  assert.notEqual(k(new Date(1)), k(new Date(2)))
  assert.equal(k(new Date(1)), k(new Date(1)))
  // Seul `spec.recipe.runId` est ignoré : ailleurs, un `runId` compte.
  assert.notEqual(launchKey(spec({ live: { recipe: { runId: 'x' } } })), launchKey(spec({ live: { recipe: { runId: 'y' } } })))
})

test('identité : un nouvel essai vise sa génération ; l’identifiant tiré au hasard d’un modèle ne compte pas, l’étape d’une chaîne si', () => {
  assert.notEqual(launchKey(spec(), 'job-1'), launchKey(spec()))
  assert.notEqual(launchKey(spec(), 'job-1'), launchKey(spec(), 'job-2'))
  assert.equal(launchKey(spec({ recipe: { runId: 'x', step: 0 } })), launchKey(spec({ recipe: { runId: 'y', step: 0 } })))
  assert.notEqual(launchKey(spec({ chain: { runId: 'x', step: 0 } })), launchKey(spec({ chain: { runId: 'x', step: 1 } })))
  assert.notEqual(launchKey(spec({ chain: { runId: 'x', step: 0 } })), launchKey(spec({ chain: { runId: 'y', step: 0 } })))
})

test('identité : une demande qui ne se décrit pas (référence circulaire) n’a pas de clé et n’est jamais écartée', () => {
  const loop = { kind: 'image' }
  loop.self = loop
  assert.equal(launchKey(loop), null)
  const g = createLaunchGuard()
  g.record(null, { ok: true }, 0)
  assert.equal(g.find(null, 1), null)
  assert.equal(g.size, 0)
})

test('fenêtre : la même demande est écartée pendant la fenêtre, puis de nouveau acceptée', () => {
  const g = createLaunchGuard()
  const k = launchKey(spec())
  const first = { ok: true, job: { id: 'job-1' } }
  assert.equal(g.find(k, 1000), null)
  g.record(k, first, 1000)
  assert.equal(g.find(k, 1000), first) // second appui dans le même instant
  assert.equal(g.find(k, 1000 + LAUNCH_WINDOW_MS - 1), first)
  assert.equal(g.find(launchKey(spec({ prompt: 'autre' })), 1001), null) // une autre demande passe
  assert.equal(g.find(k, 1000 + LAUNCH_WINDOW_MS), null)
  assert.equal(g.size, 0)
})

test('envoi en cours : la demande reste écartée au-delà de la fenêtre, jusqu’à la fin de l’envoi', () => {
  const g = createLaunchGuard(1500)
  const first = { ok: true, job: { id: 'job-1' } }
  g.record('k', first, 0, true)
  assert.equal(g.find('k', 60_000), first)
  g.settle('k', first)
  assert.equal(g.find('k', 60_000), null) // envoi fini et fenêtre passée
  g.record('k', first, 0, true)
  g.settle('k', first)
  assert.equal(g.find('k', 1000), first) // envoi fini, mais encore dans la fenêtre
})

test('envoi lent : la fenêtre repart de la fin de l’envoi, pas de son début', () => {
  const g = createLaunchGuard(1500)
  const first = { ok: true, job: { id: 'job-1' } }
  g.record('k', first, 0, true)
  g.settle('k', first, 6000)
  assert.equal(g.find('k', 6100), first) // appui juste après la réponse du service
  assert.equal(g.find('k', 7499), first)
  assert.equal(g.find('k', 7500), null)
})

test('envoi échoué : la demande est oubliée, on peut relancer tout de suite ; un autre lancement n’est pas touché', () => {
  const g = createLaunchGuard()
  const first = { ok: true, job: { id: 'job-1' } }
  const other = { ok: true, job: { id: 'job-2' } }
  g.record('k', first, 0, true)
  g.drop('k', other) // la fin d'un autre lancement ne libère pas celui-ci
  g.settle('k', other)
  assert.equal(g.find('k', 5000), first)
  g.drop('k', first)
  assert.equal(g.find('k', 1), null)
})

test('registre : les lancements périmés sont retirés à chaque inscription', () => {
  const g = createLaunchGuard(1500)
  g.record('a', { ok: true }, 0)
  g.record('b', { ok: true }, 100, true)
  g.record('c', { ok: true }, 5000)
  assert.equal(g.size, 2) // « a » est périmé, « b » est encore en cours d'envoi
})

test('bouton : seul un lancement réussi (true ou { ok: true }) retient le bouton', () => {
  assert.equal(launched(true), true)
  assert.equal(launched({ ok: true, job: {} }), true)
  for (const r of [undefined, null, false, '', { ok: false, missing: 3 }, {}]) assert.equal(launched(r), false)
})
