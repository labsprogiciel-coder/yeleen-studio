import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addInput, allowedAdds, capChips, draftIssues, durationsFor, fabrication, filterTemplates, framesRefsWarning, fromTemplate, insertToken, isDirty,
  issueText, moveBefore, moveStep, planIssues, removeInput, setMode, soundChoice, summarize, templateError, templatePrice, toPayload, toggleSource,
  isLeavingClick, tokenList, userNeeds,
} from '../src/lib/adminTemplates.js'
import { findVideoModel } from '@studio/catalog/template-slots'

const KLING = findVideoModel('kling-3-pro')
const SEED = findVideoModel('seedance-2-5')

const gen = (over = {}) => ({
  id: 'pub-boisson-ab12', name: 'Pub boisson fraîche', blurb: 'Ta bouteille surgit.', category: 'pub', videoKey: 'templates/pub/v.mp4', video: 'https://x/files/templates/pub/v.mp4',
  modelId: 'kling-3-pro', plans: [{ text: 'Plan 1', dur: 5 }, { text: 'Plan 2', dur: 5 }], resolution: null, ratio: null, sound: true, sort: 1, published: true,
  inputs: [
    { idx: 0, slot: 'source', kind: 'image', mode: 'user', label: 'Photo de votre bouteille', optional: false },
    { idx: 1, slot: 'start', kind: 'image', mode: 'generated', prompt: 'La bouteille sur un comptoir', from: 0 },
    { idx: 2, slot: 'element', kind: 'image', mode: 'fixed', file: 'templates/pub/glacons.png', url: 'https://x/files/templates/pub/glacons.png' },
  ],
  genjutsu: null, issues: [], ...over,
})
const gj = (over = {}) => ({
  id: 'danse-1234', name: 'Danse du marché', blurb: '', category: 'danse', videoKey: 'templates/danse/v.mp4', modelId: 'motion-transfer', plans: [], published: false,
  inputs: [], genjutsu: { tool: 'motion-transfer', sourceKey: 'templates/danse/src.mp4', source: 'u', secs: 8, prompt: 'Personne A au centre', roles: ['Personne A', 'Personne B'] },
  issues: [], ...over,
})

test('liste : recherche par nom, catégorie ou modèle (sans accents) et segments', () => {
  const list = [gen(), gj(), gen({ id: 'veo', name: 'Ancien Veo', modelId: 'disparu', published: false, issues: [{ code: 'model_removed' }] })]
  assert.deepEqual(filterTemplates(list, { q: 'fraiche' }).map((t) => t.id), ['pub-boisson-ab12'])
  assert.deepEqual(filterTemplates(list, { q: 'kling' }).map((t) => t.id), ['pub-boisson-ab12'])
  assert.deepEqual(filterTemplates(list, { q: 'mouvement' }).map((t) => t.id), ['danse-1234'])
  assert.deepEqual(filterTemplates(list, { q: 'danse' }).map((t) => t.id), ['danse-1234'])
  assert.deepEqual(filterTemplates(list, { filter: 'published' }).map((t) => t.id), ['pub-boisson-ab12'])
  assert.deepEqual(filterTemplates(list, { filter: 'draft' }).map((t) => t.id), ['danse-1234', 'veo'])
  assert.deepEqual(filterTemplates(list, { filter: 'fix' }).map((t) => t.id), ['veo'])
  assert.deepEqual(summarize(list), { total: 3, published: 1, fix: 1 })
})

test('ordre : glisser avant une ligne, monter et descendre parmi les lignes visibles', () => {
  const ids = ['a', 'b', 'c', 'd']
  assert.deepEqual(moveBefore(ids, 'd', 'b'), ['a', 'd', 'b', 'c'])
  assert.deepEqual(moveBefore(ids, 'a', null), ['b', 'c', 'd', 'a'])
  assert.deepEqual(moveBefore(ids, 'b', 'b'), ids)
  assert.deepEqual(moveStep(ids, ids, 'c', -1), ['a', 'c', 'b', 'd'])
  assert.deepEqual(moveStep(ids, ids, 'a', 1), ['b', 'a', 'c', 'd'])
  assert.equal(moveStep(ids, ids, 'a', -1), null)
  // Liste filtrée (b et d cachés) : c monte au-dessus de a, son voisin visible.
  assert.deepEqual(moveStep(ids, ['a', 'c'], 'c', -1), ['c', 'a', 'b', 'd'])
  assert.deepEqual(moveStep(ids, ['a', 'c'], 'a', 1), ['b', 'c', 'a', 'd'])
})

test('fabrication : générateur (modèle, plans, résolution), Genjutsu (outil, photos), modèle retiré en erreur', () => {
  assert.deepEqual(fabrication(gen()), { kind: 'Générateur', modelId: 'kling-3-pro', detail: 'Kling 3.0 Pro · 2 plans', error: false })
  assert.deepEqual(fabrication(gen({ modelId: 'seedance-2-5', plans: [{ text: '', dur: 8 }], resolution: '720p' })), { kind: 'Générateur', modelId: 'seedance-2-5', detail: 'Seedance 2.5 · 1 plan · 720p', error: false })
  assert.deepEqual(fabrication(gj()), { kind: 'Genjutsu', detail: 'Transfert de mouvement · 2 photos', error: false })
  assert.equal(fabrication(gen({ modelId: 'disparu' })).error, true)
})

test('prix : vidéo plus Krea 3 pour chaque image créée ; Genjutsu à la seconde ; null si modèle retiré', () => {
  const p = templatePrice(gen())
  assert.equal(p.secs, 10)
  assert.equal(p.lines.length, 2)
  assert.match(p.lines[0].label, /^Kling 3\.0 Pro, 10 s$/)
  assert.match(p.lines[1].label, /Image de début \(Krea 3\)/)
  assert.ok(p.lines[1].cost > 0)
  assert.equal(p.total, Math.round((p.lines[0].cost + p.lines[1].cost) * 10) / 10)
  const g = templatePrice(gj())
  assert.equal(g.lines.length, 1)
  assert.ok(g.total > 0)
  assert.equal(templatePrice(gen({ modelId: 'disparu' })), null)
  assert.equal(templatePrice(gj({ genjutsu: { ...gj().genjutsu, secs: null } })), null)
})

test('messages : chaque problème en français, avec l’entrée concernée et son jeton', () => {
  const inputs = gen().inputs
  assert.match(issueText({ code: 'fixed_needs_file', idx: 2 }, inputs), /^Élément @Element1 : Déposez le fichier/)
  assert.match(issueText({ code: 'too_many_references', kind: 'video' }), /vidéos/)
  assert.match(issueText({ code: 'model_removed' }), /retiré du catalogue/)
  assert.match(issueText({ code: 'inconnu' }), /inconnu/)
  for (const code of ['no_video', 'bad_plans', 'genjutsu_incomplete', 'frames_with_references', 'start_required', 'source_unused', 'user_needs_label']) {
    assert.doesNotMatch(issueText({ code }), /Problème à corriger/, code)
  }
})

test('erreurs d’appel : codes des modèles traduits, problèmes renvoyés, le reste par adminError', () => {
  const e = templateError({ status: 422, body: { error: 'invalid_template', issues: [{ code: 'no_video' }] } })
  assert.match(e.message, /pas valide/)
  assert.deepEqual(e.issues, [{ code: 'no_video' }])
  assert.match(templateError({ status: 413, body: { error: 'too_large' } }).message, /trop lourd/)
  assert.match(templateError({ status: 415, body: { error: 'unsupported_type' } }).message, /refusé/)
  assert.deepEqual(templateError({ status: 0, body: { error: 'unreachable' } }).issues, [])
})

test('brouillon : aller-retour fidèle, URL d’aperçu jamais envoyée, changement détecté', () => {
  const d = fromTemplate(gen())
  const body = toPayload(d)
  assert.equal(body.genjutsu, null)
  assert.equal(body.inputs[2].file, 'templates/pub/glacons.png')
  assert.ok(!('url' in body.inputs[2]))
  assert.deepEqual(body.plans, [{ text: 'Plan 1', dur: 5 }, { text: 'Plan 2', dur: 5 }])
  assert.equal(isDirty(d, fromTemplate(gen())), false)
  assert.equal(isDirty({ ...d, name: 'Autre' }, d), true)
  const g = toPayload(fromTemplate(gj()))
  assert.deepEqual(g.genjutsu, { tool: 'motion-transfer', sourceKey: 'templates/danse/src.mp4', secs: 8, prompt: 'Personne A au centre', roles: ['Personne A', 'Personne B'] })
  assert.deepEqual(g.inputs, [])
})

test('brouillon : une entrée fixe sans fichier part sans `file` (jamais \'\'), le brouillon reste enregistrable', () => {
  const d = fromTemplate(gen({ modelId: 'seedance-2-5', inputs: [] }))
  const inputs = setMode(addInput(d.inputs, { slot: 'reference', kind: 'image' }), 0, 'fixed')
  const body = toPayload({ ...d, inputs })
  assert.equal(body.inputs[0].mode, 'fixed')
  assert.ok(!('file' in body.inputs[0]))
  const loaded = toPayload(fromTemplate(gen({ inputs: [{ idx: 0, slot: 'element', kind: 'image', mode: 'fixed' }] })))
  assert.ok(!('file' in loaded.inputs[0]))
  assert.ok(draftIssues({ ...d, inputs }).some((i) => i.code === 'fixed_needs_file'))
})

test('brouillon Genjutsu : le format enregistré survit à l’aller-retour', () => {
  assert.equal(toPayload(fromTemplate(gj({ ratio: '9:16' }))).ratio, '9:16')
  assert.equal(toPayload(fromTemplate(gj())).ratio, null)
  const d = fromTemplate(gj({ ratio: '9:16' }))
  assert.equal(isDirty({ ...d, ratio: '1:1' }, d), true)
})

test('sortie de page : seuls les clics qui changent d’adresse dans l’application sont arrêtés', () => {
  const here = 'https://studio.test/admin?t=templates&m=x'
  const e = { button: 0 }
  const a = (href, attrs = {}) => ({ href, target: attrs.target ?? '', hasAttribute: (n) => n in attrs })
  assert.equal(isLeavingClick(e, a('/admin?t=users'), here), true)
  assert.equal(isLeavingClick(e, a('/cinema?tpl=x'), here), true)
  assert.equal(isLeavingClick(e, a('/admin?t=templates&m=x#plans'), here), false)
  assert.equal(isLeavingClick({ button: 0, metaKey: true }, a('/admin?t=users'), here), false)
  assert.equal(isLeavingClick(e, a('/cinema', { target: '_blank' }), here), false)
  assert.equal(isLeavingClick(e, a('/f.mp4', { download: '' }), here), false)
  assert.equal(isLeavingClick(e, a('https://ailleurs.test/'), here), false)
  assert.equal(isLeavingClick(e, null, here), false)
})

test('problèmes du brouillon : comme l’API (entrées, plans, vidéo, Genjutsu incomplet)', () => {
  assert.deepEqual(draftIssues(fromTemplate(gen())), [])
  assert.deepEqual(draftIssues({ ...fromTemplate(gen()), videoKey: '' }), [{ code: 'no_video' }])
  assert.deepEqual(draftIssues({ ...fromTemplate(gen()), modelId: 'disparu' }).map((i) => i.code), ['model_removed'])
  const d = fromTemplate(gen({ modelId: 'veo-3-1-lite' }))
  assert.ok(draftIssues(d).some((i) => i.code === 'bad_plans')) // Veo : un seul plan
  assert.ok(draftIssues(d).some((i) => i.code === 'elements_unsupported'))
  const g = fromTemplate(gj())
  assert.deepEqual(draftIssues(g), [])
  assert.deepEqual(draftIssues({ ...g, genjutsu: { ...g.genjutsu, roles: [''] } }), [{ code: 'genjutsu_incomplete' }])
  assert.deepEqual(draftIssues({ ...g, genjutsu: { ...g.genjutsu, secs: 30 } }), [{ code: 'genjutsu_incomplete' }])
  assert.deepEqual(planIssues(KLING, [1, 2, 3, 4, 5].map(() => ({ text: '', dur: 3 }))), [{ code: 'bad_plans' }])
  assert.deepEqual(planIssues(KLING, [{ text: '', dur: 0 }]), [{ code: 'bad_plans' }])
})

test('réglages : son au choix, durées du modèle (plus la valeur actuelle), pastilles et avertissement Seedance', () => {
  assert.equal(soundChoice(KLING), true)
  assert.equal(soundChoice(findVideoModel('kling-4')), false) // son toujours généré
  assert.ok(durationsFor(SEED, 8).includes(8))
  assert.ok(durationsFor(KLING, 7).includes(7))
  assert.ok(!durationsFor(KLING).includes(2))
  const chips = capChips(KLING)
  assert.ok(chips.some((c) => c.label === 'Image de début · obligatoire' && !c.off))
  assert.ok(chips.some((c) => c.label === '3 éléments'))
  assert.ok(chips.some((c) => c.label === 'Références' && c.off))
  assert.ok(capChips(SEED).some((c) => c.label === 'Plusieurs plans' && c.off))
  const refs = [{ idx: 0, slot: 'reference', kind: 'image', mode: 'user', label: 'x' }]
  assert.equal(framesRefsWarning(SEED, refs), false)
  assert.equal(framesRefsWarning(SEED, [...refs, { idx: 1, slot: 'start', kind: 'image', mode: 'user', label: 'y' }]), true)
  assert.equal(framesRefsWarning(KLING, refs), false)
})

test('ajouts possibles : seulement ce que le modèle accepte, dans ses limites', () => {
  const ids = (m, inputs = []) => allowedAdds(m, inputs).map((a) => a.id)
  assert.deepEqual(ids(KLING), ['start', 'end', 'element'])
  assert.deepEqual(ids(KLING, gen().inputs), ['end', 'element'])
  const three = [0, 1, 2].map((idx) => ({ idx, slot: 'element', kind: 'image', mode: 'user', label: 'e' }))
  assert.ok(!ids(KLING, three).includes('element'))
  assert.deepEqual(ids(SEED), ['start', 'end', 'ref-image', 'ref-video', 'ref-audio', 'audio'])
  assert.deepEqual(allowedAdds(null, []), [])
})

test('entrées : ajout à la fin, retrait avec renumérotation, photo de départ liée', () => {
  let list = addInput([], { slot: 'element', kind: 'image' })
  assert.deepEqual(list, [{ idx: 0, slot: 'element', kind: 'image', mode: 'user', label: '', optional: false }])
  list = addInput(list, { slot: 'start', kind: 'image' })
  list = setMode(list, 1, 'generated')
  assert.deepEqual(list[1], { idx: 1, slot: 'start', kind: 'image', mode: 'generated', prompt: '' })
  assert.equal(setMode(list, 0, 'generated'), list) // un élément ne se crée pas avec Krea
  list = toggleSource(list, 1, true, 'Votre photo')
  assert.equal(list[1].from, 2)
  assert.deepEqual(list[2], { idx: 2, slot: 'source', kind: 'image', mode: 'user', label: 'Votre photo', optional: false })
  // Retirer l'élément renumérote et suit le lien.
  const after = removeInput(list, 0)
  assert.deepEqual(after.map((i) => [i.idx, i.slot, i.from]), [[0, 'start', 1], [1, 'source', undefined]])
  // Décocher retire la photo de départ.
  assert.deepEqual(toggleSource(after, 0, false).map((i) => i.slot), ['start'])
  assert.ok(!('from' in toggleSource(after, 0, false)[0]))
  // Retirer l'image créée emporte sa photo.
  assert.deepEqual(removeInput(after, 0), [])
  // Quitter le mode « créée » retire aussi la photo.
  assert.deepEqual(setMode(after, 0, 'fixed'), [{ idx: 0, slot: 'start', kind: 'image', mode: 'fixed', file: '' }])
})

test('plans : jetons dans l’ordre des entrées, insertion au curseur avec espaces', () => {
  const inputs = [
    { idx: 0, slot: 'reference', kind: 'video', mode: 'fixed', file: 'templates/a.mp4' },
    { idx: 1, slot: 'reference', kind: 'image', mode: 'user', label: 'plat' },
    { idx: 2, slot: 'reference', kind: 'image', mode: 'user', label: 'logo' },
    { idx: 3, slot: 'start', kind: 'image', mode: 'user', label: 'x' },
  ]
  assert.deepEqual(tokenList(inputs), ['@Video1', '@Image1', '@Image2'])
  assert.deepEqual(insertToken('Gros plan de', '@Image1'), { text: 'Gros plan de @Image1', caret: 20 })
  assert.deepEqual(insertToken('ab', '@X', 1, 1), { text: 'a @X b', caret: 5 })
  assert.deepEqual(insertToken('', '@X'), { text: '@X', caret: 2 })
})

test('ce que l’utilisateur fournit : par sorte, facultatifs signalés ; Genjutsu : ses rôles', () => {
  const d = fromTemplate(gen({ inputs: [
    { idx: 0, slot: 'reference', kind: 'image', mode: 'user', label: 'plat' },
    { idx: 1, slot: 'reference', kind: 'audio', mode: 'user', label: 'musique', optional: true },
  ] }))
  assert.deepEqual(userNeeds(d).map((r) => [r.label, r.value]), [['Photos', '1 : plat'], ['Audio', '1 : musique (facultatif)']])
  assert.deepEqual(userNeeds(fromTemplate(gj())), [{ label: 'Photos', value: '2 : Personne A, Personne B' }])
  assert.deepEqual(userNeeds(fromTemplate(gen({ inputs: [] }))), [{ label: 'Fichiers', value: 'aucun' }])
})

test('message : champ refusé par l’API (invalid_field) nommé en clair', async () => {
  const { issueText } = await import('../src/lib/adminTemplates.js')
  assert.match(issueText({ code: 'invalid_field', field: 'category' }), /la catégorie/)
  assert.match(issueText({ code: 'invalid_field', field: 'zzz' }), /zzz/)
})

test('messages : nouveaux codes de l’API, détails facultatifs, codes inconnus sans plantage', async () => {
  const { issueText, templateError } = await import('../src/lib/adminTemplates.js')
  assert.match(issueText({ code: 'files_in_use', templates: ['Pub boisson', { name: 'Danse' }] }), /« Pub boisson », « Danse »/)
  assert.doesNotMatch(issueText({ code: 'files_in_use' }), /\{templates\}|\(\)/)
  assert.match(issueText({ code: 'missing_file', key: 'templates/pub/v.mp4' }), /introuvable.*\(v\.mp4\)/)
  assert.doesNotMatch(issueText({ code: 'missing_file' }), /\{key\}/)
  for (const code of ['bad_duration', 'kind_mismatch', 'plan_empty', 'unsupported_type', 'storage_unavailable']) {
    assert.doesNotMatch(issueText({ code }), /Problème à corriger|\{/, code)
  }
  assert.match(templateError({ status: 409, body: { error: 'files_in_use', templates: ['A'] } }).message, /« A »/)
  for (const bad of [undefined, null, {}, { code: 'toString' }, { code: 'constructor', idx: 1 }, { code: 'x', idx: 0 }]) {
    assert.equal(typeof issueText(bad, [{ idx: 0, slot: 'start', kind: 'image', mode: 'user' }]), 'string')
  }
  assert.equal(typeof issueText({ code: 'x', idx: 0 }, null), 'string')
})

test('enregistrement : le brouillon saisi pendant l’envoi est gardé', async () => {
  const { draftAfterSave, fromTemplate } = await import('../src/lib/adminTemplates.js')
  const sent = fromTemplate(gen())
  const fresh = fromTemplate(gen({ name: 'Pub boisson fraîche' }))
  assert.equal(draftAfterSave(sent, sent, fresh), fresh)
  assert.equal(draftAfterSave({ ...sent }, sent, fresh), fresh) // même contenu, autre objet
  const typed = { ...sent, name: 'Nouveau nom' }
  assert.equal(draftAfterSave(typed, sent, fresh), typed)
})

test('ordre : envois en série, le dernier ordre part en dernier', async () => {
  const { serialLatest } = await import('../src/lib/adminTemplates.js')
  const calls = []
  let release
  const run = (v) => { calls.push(v); return new Promise((r) => { release = r }) }
  const submit = serialLatest(run)
  const p = submit(['a'])
  submit(['b'])
  submit(['c'])
  assert.deepEqual(calls, [['a']]) // un seul envoi à la fois
  release(); await new Promise((r) => setImmediate(r))
  assert.deepEqual(calls, [['a'], ['c']]) // les ordres intermédiaires sont fusionnés
  release(); await p
  assert.deepEqual(calls, [['a'], ['c']])

  const errs = []
  const failing = serialLatest(async (v) => { calls.push(v); throw new Error('boom') }, (e) => errs.push(e.message))
  await failing(['x'])
  assert.deepEqual(errs, ['boom'])
  await failing(['y']) // de nouveau utilisable après une erreur
  assert.deepEqual(errs, ['boom', 'boom'])
})
