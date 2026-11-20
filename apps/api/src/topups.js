/**
 * Règles des recharges Mobile Money, sans dépendance à Cloudflare : testables seules, puis exécutées dans le Durable Object
 * du compte (un seul écrivain), là où vit aussi le portefeuille.
 *
 * Statuts : `pending` (enregistrée, paygate n'a pas encore répondu), `awaiting_code` (Orange Burkina : il faut d'abord le code
 * à usage unique), `processing`, `completed`, `failed`, `expired`. Seul `completed` est définitif : un paiement échoué ou expiré
 * peut encore aboutir en retard, et il est alors crédité.
 */
import { PaygateError } from './paygate.js'

export const OPEN_STATUSES = ['pending', 'awaiting_code', 'processing']
export const isOpen = (t) => OPEN_STATUSES.includes(t.status)

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Référence côté serveur : `yl_` + ULID (29 caractères, dans les 3–64 `[A-Za-z0-9_-]` de paygate). */
export function newReference(now = Date.now()) {
  let time = ''
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time
  const rand = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => CROCKFORD[b % 32]).join('')
  return `yl_${time}${rand}`
}

/**
 * Applique l'état d'un paiement paygate (réponse de création, lecture ou `data` d'un webhook) à une recharge.
 * Retourne { topup, credit } : `credit` est le nombre de jetons à créditer, toujours ceux enregistrés à la création,
 * jamais un montant calculé depuis paygate. Un montant différent n'est pas crédité (`mismatch`).
 */
export function applyPayment(topup, payment, { late = false, now = Date.now() } = {}) {
  if (!topup || payment?.reference !== topup.reference) return { topup, credit: 0, ignored: true }
  if (topup.status === 'completed') return { topup, credit: 0 }
  const next = {
    ...topup,
    paygateId: payment.id ?? topup.paygateId,
    authType: payment.method?.authType ?? topup.authType ?? null,
    instructions: payment.method?.instructions ?? topup.instructions ?? null,
    authUrl: payment.authUrl ?? topup.authUrl ?? null,
    expiresAt: payment.expiresAt ?? topup.expiresAt ?? null,
    updatedAt: now,
  }
  if (payment.status === 'completed') {
    if (payment.amount !== topup.amountFcfa || (payment.currency && payment.currency !== 'XOF')) {
      return { topup: { ...next, mismatch: { amount: payment.amount, currency: payment.currency ?? null } }, credit: 0, mismatch: true }
    }
    const wasLate = late || topup.status === 'failed' || topup.status === 'expired'
    return { topup: { ...next, status: 'completed', late: wasLate, failure: null, completedAt: now }, credit: topup.jetons }
  }
  if (payment.status === 'failed' || payment.status === 'expired') {
    return { topup: { ...next, status: payment.status, failure: payment.failure ?? null }, credit: 0 }
  }
  if (payment.status === 'processing' && (topup.status === 'pending' || topup.status === 'awaiting_code')) {
    return { topup: { ...next, status: 'processing' }, credit: 0 }
  }
  return { topup: next, credit: 0 }
}

/** Ce que voit l'interface. */
export const topupView = (t) => ({
  reference: t.reference, pack: t.pack, amountFcfa: t.amountFcfa, jetons: t.jetons, operator: t.operator, phone: t.phone,
  status: t.status, authType: t.authType ?? null, instructions: t.instructions ?? null, codeInstructions: t.codeInstructions ?? null,
  authUrl: t.authUrl ?? null, failure: t.failure ?? null, late: t.late ?? false, expiresAt: t.expiresAt ?? null,
  createdAt: t.createdAt, updatedAt: t.updatedAt,
})

/**
 * Relecture d'une recharge chez paygate, puis le chemin habituel (`/topup/apply` du compte : crédit idempotent par référence, jamais
 * un statut venu du navigateur). Partagée par le suivi de l'utilisateur (GET /topups/:reference) et la revérification de l'administration.
 * `acct(path, body)` appelle le Durable Object du compte visé ; `checkedAt` est noté tant que la recharge est dans l'un des statuts `from`
 * (on y ajoute son statut actuel, sauf `completed`). Inconnue chez paygate après 2 min, une recharge `pending` passe `failed` (jamais créée).
 * Rend { topup, credited, mismatch, error } ; `error` vaut 'provider' si paygate n'a pas répondu.
 */
export async function recheckTopup({ pg, acct, topup, from = ['pending', 'processing'], now = Date.now() }) {
  let t = topup
  const stamp = [...new Set([...from, t.status])].filter((s) => s !== 'completed')
  try {
    const out = await acct('/topup/apply', { reference: t.reference, payment: await pg.collection(t.reference) })
    t = out.topup ?? t
    await acct('/topup/patch', { reference: t.reference, from: stamp, checkedAt: now })
    return { topup: t, credited: out.credited ?? 0, mismatch: out.mismatch ?? false, error: null }
  } catch (e) {
    if (e instanceof PaygateError && e.status === 404 && t.status === 'pending' && now - t.createdAt > 120_000) {
      t = (await acct('/topup/patch', { reference: t.reference, from: ['pending'], status: 'failed', failure: 'not_created' })).topup ?? t
      return { topup: t, credited: 0, mismatch: false, error: null }
    }
    console.error('lecture paygate', e.message)
    await acct('/topup/patch', { reference: t.reference, from: stamp, checkedAt: now })
    return { topup: t, credited: 0, mismatch: false, error: e instanceof PaygateError && e.status === 404 ? 'not_found' : 'provider' }
  }
}
