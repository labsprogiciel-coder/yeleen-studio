import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adminError, adminKey, failureKind, ageMin, canRecheck, cauris, checkReason, formatAge, isActiveJob, isAdminKey, isStuckJob, isStuckTopup,
  parseAmount, pick, refundable, resultText, sortTopups,
} from '../src/lib/admin.js'

test('clé d’idempotence : préfixe adm_, au format attendu par l’API, différente à chaque ouverture', () => {
  const a = adminKey()
  const b = adminKey()
  assert.match(a, /^adm_[0-9a-f-]{36}$/)
  assert.ok(isAdminKey(a))
  assert.notEqual(a, b)
  assert.ok(!isAdminKey('adm_x'))
  assert.ok(!isAdminKey('cle_12345678'))
  assert.ok(!isAdminKey(null))
})

test('motif obligatoire : coupé, 3 à 300 caractères', () => {
  assert.deepEqual(checkReason('  Geste commercial  '), { reason: 'Geste commercial' })
  assert.deepEqual(checkReason('  ab '), { error: 'reason_required' })
  assert.deepEqual(checkReason(undefined), { error: 'reason_required' })
  assert.deepEqual(checkReason('x'.repeat(301)), { error: 'reason_too_long' })
  assert.deepEqual(checkReason('x'.repeat(300)), { reason: 'x'.repeat(300) })
})

test('montant : virgule ou point, positif, une décimale, plafonné', () => {
  assert.deepEqual(parseAmount('12,5'), { amount: 12.5 })
  assert.deepEqual(parseAmount(' 50 '), { amount: 50 })
  assert.deepEqual(parseAmount('12.50'), { amount: 12.5 })
  assert.deepEqual(parseAmount(''), { error: 'amount_required' })
  assert.deepEqual(parseAmount('0'), { error: 'invalid_amount' })
  assert.deepEqual(parseAmount('-3'), { error: 'invalid_amount' })
  assert.deepEqual(parseAmount('1e3'), { error: 'invalid_amount' })
  assert.deepEqual(parseAmount('abc'), { error: 'invalid_amount' })
  assert.deepEqual(parseAmount('1,25'), { error: 'amount_precision' })
  assert.deepEqual(parseAmount('10001'), { error: 'amount_too_high', max: 10000 })
  assert.deepEqual(parseAmount('30', { max: 20 }), { error: 'amount_too_high', max: 20 })
})

test('messages d’erreur en français, avec les détails de la réponse', () => {
  assert.equal(adminError({ status: 403, body: { error: 'forbidden' } }), 'Accès réservé aux administrateurs.')
  assert.equal(adminError({ status: 0, body: { error: 'unreachable' } }), 'Impossible de joindre le studio. Vérifiez votre connexion, puis réessayez.')
  assert.match(adminError({ status: 409, body: { error: 'already_refunded', refunded: 12.5 } }), /12,5 cauris/)
  assert.match(adminError({ status: 409, body: { error: 'not_active', status: 'COMPLETED' } }), /Terminée/)
  assert.match(adminError('amount_too_high'), /10\s000 cauris/)
  assert.equal(adminError('account_blocked'), 'Votre compte est suspendu. Contactez le support.')
  assert.match(adminError({ status: 500, body: { error: 'boom' } }), /\(boom\)/)
})

test('lecture tolérante des lignes : camelCase ou snake_case', () => {
  assert.equal(pick({ createdAt: 1 }, 'createdAt'), 1)
  assert.equal(pick({ created_at: 2 }, 'createdAt'), 2)
  assert.equal(pick({ user_id: 'u' }, 'userId'), 'u')
  assert.equal(pick(null, 'x'), undefined)
})

test('âges : minutes entières, format court', () => {
  const now = Date.parse('2026-11-20T12:00:00Z')
  assert.equal(ageMin(now - 125_000, now), 2)
  assert.equal(ageMin(now + 60_000, now), 0)
  assert.equal(ageMin(null, now), null)
  assert.equal(ageMin('2026-11-20T11:00:00Z', now), 60)
  assert.equal(formatAge(4), '4 min')
  assert.equal(formatAge(125), '2 h 05')
  assert.equal(formatAge(3 * 24 * 60 + 5), '3 j')
  assert.equal(formatAge(null), '—')
})

test('recharges bloquées : ouvertes depuis plus de 10 minutes, montrées en premier', () => {
  const now = Date.parse('2026-11-20T12:00:00Z')
  const old = { reference: 'a', status: 'pending', created_at: now - 11 * 60_000 }
  const fresh = { reference: 'b', status: 'processing', createdAt: now - 60_000 }
  const paid = { reference: 'c', status: 'completed', createdAt: now - 60 * 60_000 }
  assert.ok(isStuckTopup(old, now))
  assert.ok(!isStuckTopup(fresh, now))
  assert.ok(!isStuckTopup(paid, now))
  assert.ok(isStuckTopup({ ...fresh, stuck: true }, now))
  assert.deepEqual(sortTopups([paid, fresh, old], now).map((t) => t.reference), ['a', 'b', 'c'])
  assert.ok(canRecheck('failed') && canRecheck('expired') && canRecheck('pending'))
  assert.ok(!canRecheck('completed'))
})

test('générations : actives, bloquées après 30 minutes, remboursables une fois', () => {
  const now = Date.parse('2026-11-20T12:00:00Z')
  assert.ok(isActiveJob('IN_QUEUE') && isActiveJob('IN_PROGRESS'))
  assert.ok(!isActiveJob('COMPLETED') && !isActiveJob('CANCELED') && !isActiveJob(undefined))
  assert.ok(isStuckJob({ status: 'IN_PROGRESS', created_at: now - 31 * 60_000 }, now))
  assert.ok(!isStuckJob({ status: 'IN_PROGRESS', ageMin: 5 }, now))
  assert.ok(isStuckJob({ status: 'IN_QUEUE', stuck: true }, now))
  assert.equal(refundable({ status: 'COMPLETED', cost: 40, refund: 0 }), 40)
  assert.equal(refundable({ status: 'FAILED', cost: 40, refund: 40 }), 0)
  assert.equal(refundable({ status: 'IN_PROGRESS', cost: 40 }), 0)
})

test('compte-rendu des actions, solde formaté en cauris', () => {
  assert.equal(cauris(1234.5), (1234.5).toLocaleString('fr-FR', { maximumFractionDigits: 1 }))
  assert.match(resultText('credit', { amount: 50, balance: 290 }), /^Crédit de 50 cauris enregistré\. Nouveau solde : 290 cauris\.$/)
  assert.match(resultText('debit', { amount: 1, balance: 0, replayed: true }), /déjà enregistrée/)
  assert.match(resultText('refund_job', { refunded: 12.5, balance: 100 }), /12,5 cauris remboursés/)
  assert.match(resultText('cancel_job', { outcome: 'completed' }), /rien n’a été remboursé/)
  assert.match(resultText('cancel_job', { outcome: 'canceled', refunded: 40 }), /annulée, 40 cauris rendus/)
  assert.equal(resultText('block', {}), 'Compte suspendu.')
  assert.match(resultText('recheck_topup', { topup: { status: 'completed' }, balance: 500 }), /Payée/)
})

test('annulation : une génération échouée chez le fournisseur pendant le suivi n’est pas annoncée comme annulée', () => {
  const t = resultText('cancel_job', { outcome: 'failed', refunded: 12, balance: 100 })
  assert.match(t, /avait échoué chez le fournisseur/)
  assert.match(t, /12 cauris/)
  assert.doesNotMatch(t, /Génération annulée/)
  assert.match(resultText('cancel_job', { outcome: 'canceled', refunded: 12 }), /^Génération annulée, 12 cauris rendus\.$/)
  assert.match(adminError({ status: 409, body: { error: 'storing', status: 'IN_PROGRESS' } }), /en cours d’enregistrement/)
})

test('revérification : paygate ne connaît pas le paiement (502 not_found) → message propre, sans « Réessayer » ; les autres 5xx restent incertains', () => {
  const unknown = { status: 502, body: { error: 'not_found' } }
  assert.match(adminError(unknown), /Paygate ne connaît pas ce paiement/)
  assert.equal(failureKind(unknown), 'final')
  assert.match(adminError({ status: 404, body: { error: 'not_found' } }), /^Introuvable/)
  assert.equal(failureKind({ status: 404, body: { error: 'not_found' } }), 'refused')
  assert.equal(failureKind({ status: 502, body: { error: 'provider' } }), 'uncertain')
  assert.equal(failureKind({ status: 0 }), 'uncertain')
})
