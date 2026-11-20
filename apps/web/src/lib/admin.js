/**
 * Administration côté interface : clés d'idempotence, contrôle des montants et des motifs, messages d'erreur, âges et libellés.
 * Sans React ni navigateur (testé par test/admin.test.js). La vraie garde est côté API : ces contrôles évitent seulement un aller-retour.
 */

/** Plafond d'un ajustement manuel, le même que `ADMIN_MAX_ADJUST` par défaut côté API. */
export const MAX_ADJUST = 10000
/** Une recharge encore ouverte après 10 minutes, une génération active après 30 minutes : « bloquée ». */
export const TOPUP_STUCK_MIN = 10
export const JOB_STUCK_MIN = 30

/** Nouvelle clé d'idempotence `adm_<uuid>` : une par ouverture de fenêtre, réutilisée si l'on réessaie. */
export const adminKey = () => `adm_${globalThis.crypto.randomUUID()}`
export const isAdminKey = (k) => typeof k === 'string' && /^adm_[\w-]{8,80}$/.test(k)

/** Motif obligatoire, 3 à 300 caractères après coupe des blancs. Renvoie { reason } ou { error }. */
export function checkReason(text) {
  const reason = String(text ?? '').trim()
  if (reason.length < 3) return { error: 'reason_required' }
  if (reason.length > 300) return { error: 'reason_too_long' }
  return { reason }
}

/**
 * Montant en cauris saisi à la main (« 12,5 » ou « 12.5 ») : fini, strictement positif, une décimale au plus, plafonné.
 * Renvoie { amount } ou { error }.
 */
export function parseAmount(text, { max = MAX_ADJUST } = {}) {
  const raw = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.')
  if (!raw) return { error: 'amount_required' }
  if (!/^\d+(\.\d+)?$/.test(raw)) return { error: 'invalid_amount' }
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'invalid_amount' }
  if (!/^\d+(\.\d0*)?$/.test(raw)) return { error: 'amount_precision' }
  if (amount > max) return { error: 'amount_too_high', max }
  return { amount }
}

/** Cauris en français (« 1 234,5 »), comme `jetons()` de lib/jobs.jsx, que l'on ne peut pas importer hors navigateur. */
export const cauris = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—')
export const caurisLabel = (n) => `${cauris(n)} cauri${n >= 2 ? 's' : ''}`

const MESSAGES = {
  forbidden: 'Accès réservé aux administrateurs.',
  unauthorized: 'Votre session a expiré. Reconnectez-vous, puis réessayez.',
  unreachable: 'Impossible de joindre le studio. Vérifiez votre connexion, puis réessayez.',
  not_found: 'Introuvable : ce compte, cette génération ou cette recharge n’existe pas.',
  unknown_job: 'Génération introuvable sur ce compte.',
  reason_required: 'Indiquez un motif (3 caractères au moins).',
  reason_too_long: 'Le motif est trop long (300 caractères au plus).',
  invalid_reason: 'Indiquez un motif de 3 à 300 caractères.',
  amount_required: 'Indiquez un montant.',
  invalid_amount: 'Montant invalide : un nombre positif, par exemple 50 ou 12,5.',
  amount_precision: 'Une seule décimale au plus (par exemple 12,5).',
  amount_too_high: 'Montant trop élevé : {max} cauris au plus par opération.',
  invalid_key: 'Clé d’opération invalide. Fermez la fenêtre et recommencez.',
  key_conflict: 'Cette opération a déjà été envoyée avec d’autres valeurs. Fermez la fenêtre et rouvrez-la pour une nouvelle opération.',
  insufficient: 'Solde insuffisant : un débit ne peut pas rendre le solde négatif.',
  already_refunded: 'Cette génération a déjà été remboursée ({refunded} cauris).',
  no_debit: 'Rien n’a été débité pour cette génération : il n’y a rien à rembourser.',
  not_active: 'Cette génération n’est plus en cours (statut : {status}).',
  storing: 'Cette génération est terminée chez le fournisseur et ses fichiers sont en cours d’enregistrement : elle va se terminer. Rien n’a été annulé ni remboursé.',
  paygate_not_found: 'Paygate ne connaît pas ce paiement : il n’a jamais été créé chez lui. Rien n’a changé, une nouvelle vérification donnera le même résultat.',
  payments_not_configured: 'Paygate n’est pas configuré sur cette API : impossible de revérifier.',
  provider: 'Paygate ne répond pas. Réessayez dans un instant.',
  account_blocked: 'Votre compte est suspendu. Contactez le support.',
  invalid_user: 'Identifiant de compte invalide.',
  invalid_direction: 'Choisissez « Créditer » ou « Débiter ».',
  invalid_blocked: 'Demande de blocage invalide.',
  invalid_status: 'Filtre de statut invalide.',
  job_active: 'Cette génération est encore en cours : utilisez « Annuler et rembourser ».',
  already_completed: 'Cette recharge est déjà payée et créditée.',
  db_unavailable: 'La base de données de l’API est indisponible.',
}

/** Revérification : paygate ne connaît pas le paiement (502 `not_found`). Rien n'a bougé et réessayer donnerait la même réponse. */
const paygateUnknown = (err) => err?.status === 502 && err?.body?.error === 'not_found'

/**
 * Refus que l'API rend après avoir lu la clé et examiné l'action : rien n'a bougé sous cette clé. Un autre 4xx (401 de la connexion,
 * 403 de la garde administrateur, code inconnu) arrive avant la lecture de la clé : il ne dit rien d'un premier envoi resté sans réponse.
 */
const REFUSALS = new Set([
  'invalid_key', 'invalid_reason', 'invalid_amount', 'invalid_direction', 'invalid_blocked', 'invalid_user', 'insufficient', 'key_conflict',
  'already_refunded', 'not_active', 'storing', 'no_debit', 'job_active', 'not_found', 'already_completed',
])

/**
 * Issue d'un échec dans la fenêtre d'action : `refused` (4xx d'un refus examiné, rien n'a bougé : nouvelle clé, saisie corrigeable),
 * `final` (rien n'a bougé et réessayer ne changerait rien : on ne propose que de fermer), sinon `uncertain` (réseau, 5xx, 401, 403,
 * 4xx inconnu : même clé, champs figés ; un premier envoi peut avoir abouti, la même clé le rejoue sans le refaire).
 */
export function failureKind(err) {
  if (paygateUnknown(err)) return 'final'
  if (err?.status >= 400 && err.status < 500 && REFUSALS.has(err?.body?.error)) return 'refused'
  return 'uncertain'
}

/** Message lisible pour une erreur de l'API (`ApiError`) ou un code, avec les détails de la réponse (plafond, montant déjà rendu, statut). */
export function adminError(err) {
  const code = typeof err === 'string' ? err : err?.status === 0 ? 'unreachable' : err?.status === 401 ? 'unauthorized' : paygateUnknown(err) ? 'paygate_not_found' : err?.body?.error ?? err?.error ?? err?.message
  const d = typeof err === 'string' ? {} : { ...err, ...err?.body }
  const text = MESSAGES[code] ?? `L’opération a échoué${code ? ` (${code})` : ''}. Réessayez, ou vérifiez l’état du compte.`
  return text
    .replace('{max}', cauris(d.max ?? MAX_ADJUST))
    .replace('{refunded}', cauris(d.refunded))
    .replace('{status}', JOB_STATUS[d.status] ?? String(d.status ?? '?'))
}

/** Lecture tolérante d'une ligne : l'API renvoie du camelCase, D1 du snake_case (`createdAt` ou `created_at`). */
export function pick(row, name) {
  if (!row) return undefined
  if (row[name] !== undefined) return row[name]
  return row[name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]
}

/** Date en millisecondes (nombre, chaîne numérique ou ISO), ou null. */
export function toMs(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(v)
  return Number.isFinite(n) ? n : null
}

/** Âge en minutes entières depuis `at` (jamais négatif), ou null sans date. */
export function ageMin(at, now = Date.now()) {
  const ms = toMs(at)
  return ms == null ? null : Math.max(0, Math.floor((now - ms) / 60_000))
}

/** « 4 min », « 2 h 05 », « 3 j » : la durée courte d'un âge en minutes. */
export function formatAge(min) {
  if (min == null || !Number.isFinite(min)) return '—'
  if (min < 60) return `${min} min`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
  return `${Math.floor(min / (24 * 60))} j`
}

/** Date et heure courtes en français (« 19/10/2026 10:05 »). */
export function formatDate(at) {
  const ms = toMs(at)
  if (ms == null) return '—'
  return new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const JOB_STATUS = { IN_QUEUE: 'En file', IN_PROGRESS: 'En cours', COMPLETED: 'Terminée', FAILED: 'Échouée', CANCELED: 'Annulée' }
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELED'])
export const isActiveJob = (status) => Boolean(status) && !TERMINAL.has(status)

export const TOPUP_STATUS = {
  created: 'Créée', pending: 'En attente', awaiting_code: 'Code attendu', processing: 'En traitement',
  completed: 'Payée', failed: 'Échouée', expired: 'Expirée',
}
const TOPUP_FINAL = new Set(['completed', 'failed', 'expired'])
export const isOpenTopup = (status) => Boolean(status) && !TOPUP_FINAL.has(status)
/** Une recharge se revérifie tant qu'elle n'est pas payée (échouée ou expirée comprises : le paiement a pu arriver tard). */
export const canRecheck = (status) => status !== 'completed'

export const ACTIONS = {
  credit: 'Crédit', debit: 'Débit', refund_job: 'Remboursement', cancel_job: 'Annulation', recheck_topup: 'Revérification',
  block: 'Blocage', unblock: 'Déblocage',
}
export const LEDGER_KIND = { credit: 'Crédit', debit: 'Débit', refund: 'Remboursement' }

/** Recharge bloquée : drapeau de l'API s'il est là, sinon encore ouverte et créée il y a plus de 10 minutes. */
export const isStuckTopup = (t, now = Date.now()) => (typeof t?.stuck === 'boolean' ? t.stuck : isOpenTopup(t?.status) && (ageMin(pick(t, 'createdAt'), now) ?? 0) >= TOPUP_STUCK_MIN)
/** Génération bloquée : drapeau de l'API s'il est là, sinon encore active après 30 minutes. */
export const isStuckJob = (j, now = Date.now()) => (typeof j?.stuck === 'boolean' ? j.stuck : isActiveJob(j?.status) && (j?.ageMin ?? ageMin(pick(j, 'createdAt'), now) ?? 0) >= JOB_STUCK_MIN)

/** Recharges : les bloquées d'abord, puis les plus récentes. */
export function sortTopups(list, now = Date.now()) {
  return [...(list ?? [])].sort((a, b) => (isStuckTopup(b, now) - isStuckTopup(a, now)) || ((toMs(pick(b, 'createdAt')) ?? 0) - (toMs(pick(a, 'createdAt')) ?? 0)))
}

/** Ce qui reste remboursable sur une génération terminée : le coût s'il n'a encore rien été rendu, sinon 0 (un seul remboursement). */
export function refundable(job) {
  const cost = Number(pick(job, 'cost')) || 0
  const back = Number(pick(job, 'refund')) || 0
  if (isActiveJob(job?.status) || back > 0) return 0
  return cost
}

/** Compte-rendu d'une action réussie, à partir de la réponse du serveur. */
export function resultText(action, r = {}) {
  const bal = typeof r.balance === 'number' ? ` Nouveau solde : ${caurisLabel(r.balance)}.` : ''
  const again = r.replayed ? ' (opération déjà enregistrée : résultat d’origine)' : ''
  if (action === 'credit' || action === 'debit') return `${action === 'credit' ? 'Crédit' : 'Débit'} de ${caurisLabel(r.amount ?? 0)} enregistré${again}.${bal}`
  if (action === 'refund_job') return `${caurisLabel(r.refunded ?? 0)} remboursé${(r.refunded ?? 0) >= 2 ? 's' : ''}${again}.${bal}`
  if (action === 'cancel_job') {
    if (r.outcome === 'completed') return `La génération était terminée chez le fournisseur : elle a été enregistrée avec ses fichiers, rien n’a été remboursé.${bal}`
    if (r.outcome === 'failed') return `La génération avait échoué chez le fournisseur : elle n’a pas été annulée, elle a déjà été remboursée (${caurisLabel(r.refunded ?? 0)})${again}.${bal}`
    return `Génération annulée, ${caurisLabel(r.refunded ?? 0)} rendu${(r.refunded ?? 0) >= 2 ? 's' : ''}${again}.${bal}`
  }
  if (action === 'block' || action === 'unblock') return action === 'block' ? `Compte suspendu${again}.` : `Compte réactivé${again}.`
  if (action === 'recheck_topup') {
    const s = r.topup?.status
    return `Recharge revérifiée : ${TOPUP_STATUS[s] ?? s ?? 'statut inconnu'}${r.topup?.mismatch ? ' (montant différent : non créditée)' : ''}.${bal}`
  }
  return `Opération enregistrée.${bal}`
}
