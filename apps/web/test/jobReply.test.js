import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cancelPatch } from '../src/lib/jobReply.js'

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
