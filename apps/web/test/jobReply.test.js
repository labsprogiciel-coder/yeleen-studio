import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cancelPatch, createPatch, lostPatch } from '../src/lib/jobReply.js'

const FAILURES = { provider: {}, moderation: {} }

test('annulation confirmée : seul le remboursement du serveur est repris', () => {
  assert.deepEqual(cancelPatch({ status: 'CANCELED', refund: 12 }, FAILURES), { refund: 12 })
})

test('terminée chez le fournisseur avant l’annulation : la génération reprend son statut et ses fichiers', () => {
  const p = cancelPatch({ status: 'COMPLETED', outputs: [{ url: 'a' }], refund: 0 }, FAILURES)
  assert.deepEqual([p.status, p.outputs[0].url, p.refund], ['COMPLETED', 'a', 0])
  assert.deepEqual(cancelPatch({ status: 'FAILED', failure: 'moderation', refund: 8 }, FAILURES), { status: 'FAILED', failure: 'moderation', refund: 8 })
  assert.equal(cancelPatch({ status: 'FAILED', failure: 'admin_cancel' }, FAILURES).failure, 'provider') // échec inconnu de l'interface
})

test('encore active (fichiers en cours d’enregistrement) : le suivi reprend', () => {
  assert.equal(cancelPatch({ status: 'IN_PROGRESS', refund: 0 }, FAILURES).status, 'IN_PROGRESS')
})

test('envoi : une génération déjà échouée côté serveur (nouvel essai, même clé) échoue tout de suite, avec son remboursement', () => {
  assert.deepEqual(createPatch({ jobId: 'j1', status: 'FAILED', failure: 'moderation', refund: 8, deduped: true }, FAILURES, 5), { remoteId: 'j1', status: 'FAILED', failure: 'moderation', refund: 8, finishedAt: 5 })
  assert.equal(createPatch({ jobId: 'j1', status: 'FAILED', failure: 'timeout', refund: 8 }, FAILURES, 5).failure, 'provider') // code inconnu de l'interface
  assert.equal(createPatch({ jobId: 'j1', status: 'FAILED' }, FAILURES, 5).refund, 0)
})

test('envoi : une génération acceptée ou encore active ne reçoit que son identifiant, le suivi fait le reste', () => {
  assert.deepEqual(createPatch({ jobId: 'j1', status: 'IN_QUEUE', cost: 4 }, FAILURES, 5), { remoteId: 'j1' })
  assert.deepEqual(createPatch({ jobId: 'j1', status: 'COMPLETED', deduped: true }, FAILURES, 5), { remoteId: 'j1' })
})

test('suivi introuvable : rien avant trois réponses 404 de suite, puis un échec « lost » sans remboursement annoncé', () => {
  assert.equal(lostPatch(1, 5), null)
  assert.equal(lostPatch(2, 5), null)
  assert.deepEqual(lostPatch(3, 5), { status: 'FAILED', failure: 'lost', refund: 0, finishedAt: 5 })
})
