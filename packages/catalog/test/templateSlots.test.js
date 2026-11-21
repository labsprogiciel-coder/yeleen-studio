import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findVideoModel, inputIssues, legacyInputs, slotRules, slotTokens, userInputs } from '../src/templateSlots.js'

const codes = (m, inputs) => inputIssues(findVideoModel(m), inputs).map((i) => i.code)

test('règles : Kling 3 (début obligatoire, fin, 3 éléments), Seedance (références), Kling 4 (fin avec début), LTX texte', () => {
  assert.deepEqual(slotRules(findVideoModel('kling-3-pro')), { start: 'required', end: true, elements: 3, references: null, audio: null, multiShot: true })
  assert.deepEqual(slotRules(findVideoModel('seedance-2-5')).references, { image: 30, video: 10, audio: 10 })
  assert.equal(slotRules(findVideoModel('kling-4')).end, 'withStart')
  assert.deepEqual(slotRules(findVideoModel('ltx-2-3-pro-t2v')), { start: null, end: false, elements: 0, references: null, audio: null, multiShot: false })
  assert.equal(slotRules(findVideoModel('ltx-2-3-a2v')).audio, 'required')
})

test('entrées valides : Kling 3 avec début généré depuis une photo, fin fixe, deux éléments', () => {
  const inputs = [
    { idx: 0, slot: 'source', kind: 'image', mode: 'user', label: 'Photo de votre bouteille' },
    { idx: 1, slot: 'start', kind: 'image', mode: 'generated', prompt: 'la bouteille sur un comptoir', from: 0 },
    { idx: 2, slot: 'end', kind: 'image', mode: 'fixed', file: 'templates/pub/fin.png' },
    { idx: 3, slot: 'element', kind: 'image', mode: 'user', label: 'Votre bouteille' },
    { idx: 4, slot: 'element', kind: 'image', mode: 'fixed', file: 'templates/pub/glacons.png' },
  ]
  assert.deepEqual(codes('kling-3-pro', inputs), [])
  assert.deepEqual(slotTokens(inputs), { 3: '@Element1', 4: '@Element2' })
  assert.deepEqual(userInputs(inputs).map((i) => i.idx), [0, 3])
})

test('problèmes : début manquant, trop d’éléments, fin sans début, références et images de cadre ensemble', () => {
  assert.ok(codes('kling-3-pro', []).includes('start_required'))
  const el = (idx) => ({ idx, slot: 'element', kind: 'image', mode: 'user', label: 'x' })
  assert.ok(codes('kling-3-pro', [{ idx: 0, slot: 'start', kind: 'image', mode: 'user', label: 'x' }, el(1), el(2), el(3), el(4)]).includes('too_many_elements'))
  assert.ok(codes('kling-4', [{ idx: 0, slot: 'end', kind: 'image', mode: 'user', label: 'x' }]).includes('end_needs_start'))
  const seed = [{ idx: 0, slot: 'start', kind: 'image', mode: 'user', label: 'x' }, { idx: 1, slot: 'reference', kind: 'image', mode: 'user', label: 'y' }]
  assert.ok(codes('seedance-2-5', seed).includes('frames_with_references'))
  assert.ok(codes('wan-3', [{ idx: 0, slot: 'reference', kind: 'image', mode: 'user', label: 'x' }]).includes('references_unsupported'))
  assert.ok(codes('ltx-2-3-pro-t2v', [{ idx: 0, slot: 'start', kind: 'image', mode: 'fixed', file: 'templates/a.png' }]).includes('start_unsupported'))
})

test('problèmes par entrée : fichier, libellé, consigne, source, type', () => {
  const m = 'seedance-2-5'
  assert.deepEqual(inputIssues(findVideoModel(m), [{ idx: 0, slot: 'reference', kind: 'image', mode: 'fixed', file: 'uploads/x.png' }]), [{ code: 'fixed_needs_file', idx: 0 }])
  assert.ok(codes(m, [{ idx: 0, slot: 'reference', kind: 'image', mode: 'user', label: ' ' }]).includes('user_needs_label'))
  assert.ok(codes(m, [{ idx: 0, slot: 'reference', kind: 'image', mode: 'generated', prompt: 'a' }]).includes('generated_only_frames'))
  assert.ok(codes(m, [{ idx: 0, slot: 'start', kind: 'image', mode: 'generated', prompt: 'a', from: 3 }]).includes('bad_from'))
  assert.ok(codes(m, [{ idx: 0, slot: 'start', kind: 'video', mode: 'user', label: 'a' }]).includes('bad_kind'))
  assert.ok(codes(m, [{ idx: 0, slot: 'source', kind: 'image', mode: 'user', label: 'a' }]).includes('source_unused'))
  assert.ok(codes(m, [{ idx: 0, slot: 'reference', kind: 'image', mode: 'user', label: 'a' }, { idx: 0, slot: 'reference', kind: 'image', mode: 'user', label: 'b' }]).includes('bad_idx'))
  assert.deepEqual(codes('nope', []), ['unknown_model'])
})

test('Seedance : jetons par type, dans l’ordre des entrées', () => {
  const inputs = [
    { idx: 2, slot: 'reference', kind: 'image', mode: 'user', label: 'logo' },
    { idx: 0, slot: 'reference', kind: 'video', mode: 'fixed', file: 'templates/x/m.mp4' },
    { idx: 1, slot: 'reference', kind: 'image', mode: 'user', label: 'plat' },
    { idx: 3, slot: 'reference', kind: 'audio', mode: 'user', label: 'son', optional: true },
  ]
  assert.deepEqual(slotTokens(inputs), { 0: '@Video1', 1: '@Image1', 2: '@Image2', 3: '@Audio1' })
  assert.deepEqual(codes('seedance-2-5', inputs), [])
})

test('anciens modèles : photo + consigne Krea → source à fournir et début généré', () => {
  assert.deepEqual(legacyInputs({ image: null, photo: 'x' }), [{ idx: 0, slot: 'start', kind: 'image', mode: 'user', label: 'x' }])
  assert.deepEqual(legacyInputs({ image: null, photo: null }), [])
  assert.deepEqual(legacyInputs({ image: 'p', photo: null }), [{ idx: 0, slot: 'start', kind: 'image', mode: 'generated', prompt: 'p' }])
  assert.deepEqual(legacyInputs({ image: 'p', photo: 'Votre photo' }).map((i) => [i.slot, i.mode, i.from]), [['source', 'user', undefined], ['start', 'generated', 0]])
  assert.deepEqual(codes('seedance-2-5', legacyInputs({ image: 'p', photo: 'Votre photo' })), [])
})

test('facultatif : après les obligatoires de sa famille (jetons stables), jamais pour une photo source, un début exigé ou un son exigé', () => {
  const el = (idx, optional) => ({ idx, slot: 'element', kind: 'image', mode: 'user', label: 'x', optional })
  const start = { idx: 0, slot: 'start', kind: 'image', mode: 'user', label: 'd' }
  // Élément facultatif suivi d'un obligatoire : omis, il décalerait « @Element2 ».
  assert.deepEqual(inputIssues(findVideoModel('kling-3-pro'), [start, el(1, true), el(2, false)]), [{ code: 'optional_not_last', idx: 1 }])
  assert.deepEqual(codes('kling-3-pro', [start, el(1, false), el(2, true), el(3, true)]), [])
  // Seedance : par type de référence ; un fixe après un facultatif compte aussi.
  const ref = (idx, kind, mode, optional) => ({ idx, slot: 'reference', kind, mode, label: 'x', file: 'templates/a/b', optional })
  assert.deepEqual(codes('seedance-2-5', [ref(0, 'image', 'user', true), ref(1, 'audio', 'user', false)]), [])
  assert.deepEqual(inputIssues(findVideoModel('seedance-2-5'), [ref(0, 'image', 'user', true), ref(1, 'image', 'fixed')]), [{ code: 'optional_not_last', idx: 0 }])
  // Photo source facultative : l'image créée (obligatoire) ne pourrait pas se faire.
  const src = [{ idx: 0, slot: 'source', kind: 'image', mode: 'user', label: 'p', optional: true }, { idx: 1, slot: 'start', kind: 'image', mode: 'generated', prompt: 'x', from: 0 }]
  assert.deepEqual(inputIssues(findVideoModel('seedance-2-5'), src), [{ code: 'cannot_be_optional', idx: 0 }])
  // Fin « avec début » (Kling 4, Wan, Flux) : un début facultatif ne suffit pas.
  const end = { idx: 1, slot: 'end', kind: 'image', mode: 'fixed', file: 'templates/a/f.png' }
  for (const m of ['kling-4', 'wan-3', 'flux-3-max']) {
    assert.ok(codes(m, [{ ...start, optional: true }, end]).includes('end_needs_start'), m)
    assert.ok(!codes(m, [start, end]).includes('end_needs_start'), m)
  }
  // Son exigé : un son facultatif ne suffit pas.
  assert.ok(codes('ltx-2-3-a2v', [{ idx: 0, slot: 'audio', kind: 'audio', mode: 'user', label: 's', optional: true }]).includes('audio_required'))
  assert.ok(!codes('ltx-2-3-a2v', [{ idx: 0, slot: 'audio', kind: 'audio', mode: 'user', label: 's' }]).includes('audio_required'))
})

test('entrées nulles : signalées (bad_idx) sans faire échouer les recherches de source', () => {
  const inputs = [null, { idx: 0, slot: 'source', kind: 'image', mode: 'user', label: 'p' }, { idx: 1, slot: 'start', kind: 'image', mode: 'generated', prompt: 'x', from: 0 }, null]
  assert.deepEqual(codes('seedance-2-5', inputs), ['bad_idx', 'bad_idx'])
})
