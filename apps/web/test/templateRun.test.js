import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_MODELS, findModel, imageCost } from '@studio/catalog'
import { findTool, toolCost } from '@studio/catalog/tools'
import {
  TOKEN_PATTERN, blockerText, canGenerate, generatedCost, generatedTotal, inputTitle, missingInputs, sentInputs, todoText, tokenItems, tplInputs, tplParam, tplRatio,
} from '../src/lib/templateRun.js'

const kling = {
  id: 'pub', name: 'Pub', modelId: 'kling-3-pro', ratio: '9:16', plans: [{ text: '@Element1 danse', dur: 5 }],
  inputs: [
    { idx: 2, slot: 'element', kind: 'image', mode: 'user', label: 'Votre produit', optional: true },
    { idx: 0, slot: 'source', kind: 'image', mode: 'user', label: 'Votre photo' },
    { idx: 1, slot: 'start', kind: 'image', mode: 'generated', prompt: 'La personne au marché', from: 0 },
    { idx: 3, slot: 'element', kind: 'image', mode: 'fixed', url: 'https://x/files/templates/pub/a.png' },
  ],
}
const seed = {
  id: 'seed', name: 'Seed', modelId: 'seedance-2-5', ratio: 'auto', plans: [{ text: '@Image1 et @Video1', dur: 5 }],
  inputs: [
    { idx: 0, slot: 'reference', kind: 'image', mode: 'user', label: 'Votre visage' },
    { idx: 1, slot: 'reference', kind: 'video', mode: 'fixed', url: 'https://x/files/templates/seed/v.mp4' },
    { idx: 2, slot: 'reference', kind: 'image', mode: 'user', label: 'Votre logo', optional: true },
  ],
}

test('les entrées sont rangées par idx ; sans entrées, l’équivalent des anciennes colonnes', () => {
  assert.deepEqual(tplInputs(kling).map((i) => i.idx), [0, 1, 2, 3])
  assert.deepEqual(tplInputs({ image: 'Un marché', photo: 'Votre photo' }).map((i) => [i.slot, i.mode, i.from]), [['source', 'user', undefined], ['start', 'generated', 0]])
  assert.deepEqual(tplInputs({ image: 'Un marché', photo: null }).map((i) => i.slot), ['start'])
  assert.deepEqual(tplInputs({ image: null, photo: null }), [])
  assert.deepEqual(tplInputs({ genjutsu: { tool: 'motion-transfer', roles: ['A'] } }), [])
  assert.deepEqual(tplInputs(null), [])
})

test('format des images Krea : celui de la vidéo, 16:9 si « auto »', () => {
  assert.equal(tplRatio(kling), '9:16')
  assert.equal(tplRatio(seed), '16:9')
  assert.equal(tplRatio({}), '16:9')
})

test('coût d’une image créée : retouche d’une photo ou texte seul, comme avant', () => {
  const edit = toolCost(findTool('template-image'), { model: 'krea-3', images: ['fichier'], prompt: 'x', ratio: '9:16' })
  assert.equal(generatedCost({ from: 0, prompt: 'x' }, '9:16'), edit)
  assert.equal(generatedCost({ prompt: 'x' }), imageCost(findModel(IMAGE_MODELS, 'krea-3'), '2K', 1))
  assert.equal(generatedTotal(kling), edit)
  assert.equal(generatedTotal(seed), 0)
})

test('titres : libellé de l’entrée, sinon le nom de sa place', () => {
  const ins = tplInputs(kling)
  assert.equal(inputTitle(ins[0], ins), 'Votre photo')
  assert.equal(inputTitle(ins[1], ins), 'Image de début')
  assert.equal(inputTitle({ idx: 9, slot: 'source', kind: 'image', mode: 'user' }, [{ idx: 8, slot: 'end', mode: 'generated', from: 9 }]), 'Photo pour l’image de fin')
  assert.equal(inputTitle({ slot: 'reference', kind: 'video', mode: 'fixed' }), 'Référence vidéo')
})

test('ce qui manque : entrées obligatoires vides et images pas encore créées', () => {
  const ins = tplInputs(kling)
  assert.deepEqual(missingInputs(ins, {}).map((m) => [m.idx, m.why]), [[0, 'user'], [1, 'generated']])
  assert.equal(blockerText(missingInputs(ins, {})), 'Ajoutez : votre photo.')
  assert.deepEqual(missingInputs(ins, { 0: { id: 'p' } }).map((m) => m.idx), [1])
  assert.equal(blockerText(missingInputs(ins, { 0: { id: 'p' } })), 'Créez d’abord l’image de début.')
  // l'image est faite : la photo source n'est plus exigée ; l'élément facultatif et le fichier fixe ne bloquent jamais
  assert.deepEqual(missingInputs(ins, { 1: { id: 'img' } }), [])
  assert.equal(blockerText([]), null)
})

test('une image se crée avec sa consigne et, si elle part d’une photo, cette photo', () => {
  const g = tplInputs(kling)[1]
  assert.equal(canGenerate(g, {}), false)
  assert.equal(canGenerate(g, { 0: { id: 'p' } }), true)
  assert.equal(canGenerate(g, { 0: { id: 'p' } }, '  '), false)
  assert.equal(canGenerate({ slot: 'start', mode: 'generated', prompt: 'x' }, {}), true)
})

test('envoyé avec la vidéo : entrées de l’utilisateur et images créées, sans les photos source ni les fichiers fixes', () => {
  const ins = tplInputs(kling)
  const given = { 0: 'photo', 1: 'image', 2: 'produit', 3: 'triche' }
  assert.deepEqual(sentInputs(ins, given), [{ idx: 1, value: 'image' }, { idx: 2, value: 'produit' }])
  assert.deepEqual(sentInputs(tplInputs(seed), { 0: 'visage' }), [{ idx: 0, value: 'visage' }])
})

test('mots-clés à citer dans le plan, numérotés par type dans l’ordre', () => {
  assert.deepEqual(tokenItems(tplInputs(kling)).map((t) => t.token), ['Element1', 'Element2'])
  assert.deepEqual(tokenItems(tplInputs(seed)).map((t) => [t.idx, t.token]), [[0, 'Image1'], [1, 'Video1'], [2, 'Image2']])
  const re = new RegExp(`^@${TOKEN_PATTERN}$`)
  assert.ok(re.test('@Element2') && re.test('@Video1') && !re.test('@Image 1'))
})

test('« à fournir » d’après les entrées, Genjutsu d’après les rôles', () => {
  assert.equal(todoText(kling), 'À ajouter dans le panneau : « Votre photo » et « Votre produit » (facultatif) ; créez ensuite l’image, puis générez.')
  assert.equal(todoText(seed), 'À ajouter dans le panneau : « Votre visage » et « Votre logo » (facultatif), puis générez.')
  assert.equal(todoText({ image: 'Un marché', photo: null }), 'Créez l’image de départ dans le panneau, puis générez.')
  assert.equal(todoText({ inputs: [] }), 'Ajustez le texte si vous voulez, puis générez.')
  assert.equal(todoText({ genjutsu: { tool: 'motion-transfer', roles: ['A', 'B'] } }), 'Ajoutez une photo par personne (2) dans le panneau, puis générez.')
  assert.equal(todoText({ genjutsu: { tool: 'object-swap', roles: ['Produit'] } }), 'Ajoutez la photo du produit dans le panneau, puis générez.')
})

test('lien ?tpl= : identifiant lu s’il est sain', () => {
  assert.equal(tplParam('?tpl=pub-boisson-ab12'), 'pub-boisson-ab12')
  assert.equal(tplParam('t=templates'), null)
  assert.equal(tplParam('?tpl=../x'), null)
  assert.equal(tplParam(''), null)
})
