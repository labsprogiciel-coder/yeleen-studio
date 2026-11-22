import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stopQuestion } from '../src/lib/stopQuestion.js'

const label = (n) => `${String(n).replace('.', ',')} cauri${n >= 2 ? 's' : ''}`
const say = (job) => { const q = stopQuestion(job, label); return `${q.title} ${q.before}${q.amount}${q.after}` }
const job = (over = {}) => ({ kind: 'video', status: 'IN_QUEUE', live: true, remoteId: 'r1', cost: 41.4, count: 1, ...over })

test('encore en file (réelle ou simulée) : tout est rendu', () => {
  assert.equal(say(job()), 'Arrêter cette vidéo ? Elle n’a pas encore commencé : vos 41,4 cauris vous seront rendus.')
  assert.equal(say(job({ live: false })), 'Arrêter cette vidéo ? Elle n’a pas encore commencé : vos 41,4 cauris vous seront rendus.')
  assert.equal(stopQuestion(job(), label).refund, 'full')
})

test('déjà en cours chez le fournisseur : rien n’est remboursé', () => {
  assert.equal(say(job({ status: 'IN_PROGRESS' })), 'Arrêter cette vidéo ? Elle est déjà en cours : vos 41,4 cauris ne seront pas remboursés.')
  assert.equal(stopQuestion(job({ status: 'IN_PROGRESS' }), label).refund, 'none')
})

test('en cours dans le moteur simulé : seule la part non consommée est rendue', () => {
  assert.equal(say(job({ status: 'IN_PROGRESS', live: false })), 'Arrêter cette vidéo ? Elle est déjà en cours : seule la part non consommée de vos 41,4 cauris vous sera rendue.')
  assert.equal(stopQuestion(job({ status: 'IN_PROGRESS', live: false }), label).refund, 'partial')
})

test('le titre et l’accord suivent ce qui est généré ; un outil reste neutre', () => {
  assert.match(say(job({ kind: 'image' })), /^Arrêter cette image \? Elle n’a pas/)
  assert.match(say(job({ kind: 'image', count: 4, status: 'IN_PROGRESS' })), /^Arrêter ces images \? Elles sont déjà en cours : vos 41,4 cauris ne seront pas remboursés\.$/)
  assert.match(say(job({ kind: 'image', count: 2 })), /^Arrêter ces images \? Elles n’ont pas encore commencé/)
  assert.match(say(job({ kind: 'audio' })), /^Arrêter cet audio \? Il n’a pas encore commencé/)
  assert.match(say(job({ kind: 'audio', status: 'IN_PROGRESS' })), /^Arrêter cet audio \? Il est déjà en cours/)
  assert.match(say(job({ kind: 'video', spec: { live: { kind: 'tool' } } })), /^Arrêter cette génération \? Elle n’a pas/)
  assert.match(say(job({ kind: 'montage', live: false })), /^Arrêter cette génération \?/)
  assert.match(say(job({ kind: 'video', spec: { live: { kind: 'workflow' } } })), /^Arrêter cette vidéo \?/)
})

test('moins de deux cauris : le singulier', () => {
  assert.equal(say(job({ kind: 'image', cost: 1.5 })), 'Arrêter cette image ? Elle n’a pas encore commencé : votre paiement de 1,5 cauri vous sera rendu.')
  assert.equal(say(job({ kind: 'image', cost: 1, status: 'IN_PROGRESS' })), 'Arrêter cette image ? Elle est déjà en cours : votre paiement de 1 cauri ne sera pas remboursé.')
  assert.equal(say(job({ kind: 'image', cost: 1, status: 'IN_PROGRESS', live: false })), 'Arrêter cette image ? Elle est déjà en cours : seule la part non consommée de votre paiement de 1 cauri vous sera rendue.')
})

test('génération réelle encore en cours d’envoi : la question ne promet aucun remboursement', () => {
  const q = stopQuestion(job({ status: 'IN_QUEUE', remoteId: undefined }), label)
  assert.equal(q.refund, 'unknown')
  assert.equal(say(job({ status: 'IN_QUEUE', remoteId: undefined })).includes('vous seront rendus'), false)
  assert.equal(say(job({ remoteId: undefined })), 'Arrêter cette vidéo ? Si elle a déjà commencé, vos 41,4 cauris ne seront pas remboursés.')
  assert.equal(stopQuestion(job(), label).refund, 'full')
})
