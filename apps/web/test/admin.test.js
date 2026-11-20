import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adminError, adminKey, attemptStore, avatarSrc, identity, failureKind, ageMin, canRecheck, cauris, checkReason, formatAge, isActiveJob, isAdminKey, isStuckJob, isStuckTopup,
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

test('échec d’une action : 401 et 403 (avant la lecture de la clé) et 4xx inconnus restent incertains — même clé, champs figés', () => {
  // Premier envoi resté sans réponse, puis la session expire : l’action a pu aboutir, une nouvelle clé la referait.
  assert.equal(failureKind({ status: 401, body: { error: 'unauthorized' } }), 'uncertain')
  assert.equal(failureKind({ status: 401 }), 'uncertain')
  assert.equal(failureKind({ status: 403, body: { error: 'forbidden' } }), 'uncertain')
  assert.equal(failureKind({ status: 429, body: { error: 'rate_limited' } }), 'uncertain')
  assert.equal(failureKind({ status: 400 }), 'uncertain')
  // Refus examinés par l’API après la clé : rien n’a bougé, nouvelle clé et saisie corrigeable.
  for (const [status, error] of [[400, 'invalid_amount'], [400, 'invalid_reason'], [400, 'invalid_key'], [402, 'insufficient'], [409, 'key_conflict'],
    [409, 'already_refunded'], [409, 'not_active'], [409, 'storing'], [409, 'no_debit'], [409, 'job_active'], [404, 'not_found'], [409, 'already_completed']]) {
    assert.equal(failureKind({ status, body: { error } }), 'refused', error)
  }
})

test('revérification : recharge en attente de moins de 2 min inconnue de paygate (502 not_found_yet) → incertain, réessayable, sans promettre le même résultat', () => {
  const young = { status: 502, body: { error: 'not_found_yet' } }
  assert.equal(failureKind(young), 'uncertain')
  assert.match(adminError(young), /pas encore/)
  assert.doesNotMatch(adminError(young), /même résultat/)
  assert.equal(failureKind({ status: 503, body: { error: 'provider_unavailable', retryable: true } }), 'uncertain')
  assert.match(adminError({ status: 503, body: { error: 'provider_unavailable' } }), /Rien n’a été annulé/)
})

test('fenêtre fermée après une issue incertaine : rouverte pour la même action et le même objet, elle reprend la même clé et la même saisie', () => {
  const store = attemptStore()
  const credit = { action: 'adjust', target: 'user_alice' }
  const attempt = { key: adminKey(), reason: 'Geste', amount: '50', direction: 'credit' }
  store.settle(credit, failureKind({ status: 0 }), attempt) // réponse perdue
  assert.deepEqual(store.get({ action: 'adjust', target: 'user_alice' }), attempt) // nouvelle ouverture : même clé
  assert.equal(store.get({ action: 'adjust', target: 'user_bob' }), null) // un autre compte : nouvelle opération
  assert.equal(store.get({ action: 'refund_job', target: 'user_alice', ref: 'j1' }), null)
  store.settle(credit, 'done') // le serveur a répondu (premier résultat rejoué) : oubliée
  assert.equal(store.get(credit), null)
  store.settle(credit, 'uncertain', attempt)
  store.settle(credit, failureKind({ status: 402, body: { error: 'insufficient' } })) // refus net : oubliée aussi
  assert.equal(store.get(credit), null)
})

test('photo de profil : https seulement, sinon rien (les initiales prennent le relais)', () => {
  assert.equal(avatarSrc('https://img.clerk.com/a1'), 'https://img.clerk.com/a1')
  for (const bad of [null, undefined, '', 'http://img.clerk.com/a1', 'javascript:alert(1)', 'data:image/png;base64,AA', 42, `https://x.test/${'a'.repeat(500)}`]) {
    assert.equal(avatarSrc(bad), null, String(bad))
  }
})

test('identité d’un compte : nom en titre et e-mail dessous, sinon l’e-mail seul, sinon l’identifiant ; initiales de repli', () => {
  assert.deepEqual(identity({ id: 'user_1', name: '  Awa   Traoré ', email: 'awa@exemple.com', avatarUrl: 'https://img.clerk.com/a' }),
    { id: 'user_1', name: 'Awa Traoré', title: 'Awa Traoré', email: 'awa@exemple.com', initials: 'AT', avatar: 'https://img.clerk.com/a' })
  assert.deepEqual(identity({ id: 'user_2', email: 'kofi.mensah@exemple.com', avatarUrl: 'http://x.test/a' }),
    { id: 'user_2', name: '', title: 'kofi.mensah@exemple.com', email: '', initials: 'KM', avatar: null })
  assert.deepEqual(identity({ id: 'user_abc' }), { id: 'user_abc', name: '', title: 'user_abc', email: '', initials: 'A', avatar: null })
  // Lignes de génération (`userId`) et de recharge (`account`), en camelCase ou snake_case.
  assert.equal(identity({ id: 'job_1', userId: 'user_9', name: 'Bob' }).id, 'user_9')
  assert.equal(identity({ reference: 'r1', account: 'user_8', avatar_url: 'https://img.clerk.com/b' }).avatar, 'https://img.clerk.com/b')
  assert.equal(identity().title, '—')
})
