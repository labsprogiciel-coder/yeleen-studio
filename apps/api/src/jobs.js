import { FalError, falClient } from './fal.js'
import { outputsOf } from './inputs.js'
import { runwareClient } from './runware.js'
import { higgsfieldClient } from './higgsfield.js'
import { storeOutputs } from './storage.js'

/**
 * Suivi d'une génération, partagé par les trois chemins qui la font avancer : l'interrogation de l'interface (`GET /jobs/:id`),
 * le webhook de fal (`/webhooks/fal`) et le réveil du Durable Object du compte (`alarm`, toutes les minutes tant qu'une génération
 * est active). Ainsi une génération se termine, est copiée dans R2 ou remboursée même si l'utilisateur a fermé la page.
 */
export const isActive = (job) => job.status === 'IN_QUEUE' || job.status === 'IN_PROGRESS'

export const STORING = 60_000 // une copie dans R2 commencée depuis moins longtemps est en cours ailleurs

// Réservée (`submitting`) mais jamais envoyée au bout de ce délai : la route est morte, le réveil la rembourse. Plus long que le plus
// long envoi (Runware : 4 essais, 3 attentes de 8 s au plus) et multiple du réveil (60 s).
export const SUBMIT_DEADLINE = 3 * 60_000
// Durée maximale d'une génération chez le fournisseur, par type ; au-delà, le réveil la fait échouer et la rembourse (`timeout`).
const CEILING = { image: 3600_000, audio: 3600_000, tryon: 3600_000 }
export const deadlineOf = (job) => job.createdAt + (job.submitting ? SUBMIT_DEADLINE : CEILING[job.kind] ?? 2 * 3600_000)

/** Refus définitif de fal (4xx autre que 408 et 429, ou refus pour contenu) ; le reste (5xx, réseau) est passager. */
const permanent = (e) => e instanceof FalError && (e.isContentPolicy || (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429))

/**
 * État d'une génération chez son fournisseur, au même format pour fal, Runware et Higgsfield :
 * { status: IN_QUEUE | IN_PROGRESS | COMPLETED | FAILED, queuePosition?, logs?, result?, failure? }.
 */
async function providerStatus(env, job) {
  if (job.provider === 'runware') {
    const st = await runwareClient({ key: env.RUNWARE_KEY }).poll(job.taskUUID)
    if (st.status === 'FAILED') {
      console.error('résultat runware', st.error.message)
      return { status: 'FAILED', failure: st.error.isContentPolicy ? 'moderation' : 'provider' }
    }
    return { status: st.status, result: st.result, logs: typeof st.progress === 'number' ? [`${st.progress} %`] : [] }
  }
  if (job.provider === 'higgsfield') {
    const st = await higgsfieldClient({ key: env.HIGGSFIELD_KEY }).poll(job.requestId)
    if (st.status === 'FAILED') {
      console.error('résultat higgsfield', st.error.message)
      return { status: 'FAILED', failure: st.error.isContentPolicy ? 'moderation' : 'provider' }
    }
    return st
  }
  const client = falClient({ key: env.FAL_KEY })
  const st = await client.status(job.statusUrl)
  if (st.status !== 'COMPLETED') return st
  try {
    return { status: 'COMPLETED', result: await client.result(job.responseUrl) }
  } catch (e) {
    // Terminée chez fal mais résultat illisible pour l'instant (5xx, 408, 429, réseau) : erreur passagère, levée. La génération reste
    // active et le prochain suivi relira le résultat ; la marquer FAILED perdrait des fichiers déjà produits (et payés chez fal).
    if (!permanent(e)) { e.completedAtProvider = true; throw e }
    console.error('résultat fal', e.message)
    return { status: 'FAILED', failure: e.isContentPolicy ? 'moderation' : 'provider' }
  }
}

/**
 * Annulation chez le fournisseur, sans garantie (une erreur est journalisée) ; Runware ne sait pas annuler.
 * Rend true seulement si le fournisseur a confirmé l'annulation : Runware, une demande pas encore envoyée (`submitting`) ou une
 * demande déjà commencée ou finie (Higgsfield : 400, 409) rendent false, et l'annulation de l'utilisateur n'est alors pas remboursée.
 * Une erreur rend null : l'issue est inconnue.
 */
export async function providerCancel(env, job) {
  if (job.submitting || job.provider === 'runware') return false
  try {
    if (job.provider === 'higgsfield') return (await higgsfieldClient({ key: env.HIGGSFIELD_KEY }).cancel(job.cancelUrl)) === true
    await falClient({ key: env.FAL_KEY }).cancel(job.cancelUrl)
    return true
  } catch (e) {
    console.error(`annulation ${job.provider ?? 'fal'}`, e.message)
    return null
  }
}

/**
 * Délai dépassé (voir deadlineOf) : annulation chez le fournisseur (sans garantie), puis échec `timeout` remboursé par le compte.
 * Réservation jamais envoyée : échouée seulement si elle l'est encore (`submitting`) ; envoyée par la route entre-temps, elle continue.
 */
export async function expireJob({ env, acct, job }) {
  if (job.submitting) return acct('/job/fail', { jobId: job.id, failure: 'timeout', submitting: true })
  await providerCancel(env, job)
  return acct('/job/fail', { jobId: job.id, failure: 'timeout' })
}

/**
 * Fait avancer une génération active d'un pas. `acct(path, body)` appelle le Durable Object du compte (POST JSON) ;
 * `origin` sert aux adresses /files des copies dans R2. Un échec rembourse (une seule fois : le remboursement est idempotent).
 * Rend { job, queuePosition?, logs?, balance? } ; une erreur passagère du fournisseur est levée (on réessaiera).
 */
export async function advanceJob({ env, acct, accountId, origin, job }) {
  // Réservée, pas encore envoyée au fournisseur : rien à lui demander (suivi, webhook en avance, réveil, annulation).
  if (job.submitting) return { job, queuePosition: 0, logs: [] }
  // Échec : le Durable Object rembourse et note FAILED d'un coup, seulement si la génération est encore active chez lui.
  const fail = async (failure) => {
    const r = await acct('/job/fail', { jobId: job.id, failure })
    return { job: r.job ?? { ...job, status: 'FAILED', failure, refund: r.refunded ?? 0, finishedAt: Date.now() }, balance: r.balance }
  }
  // Écriture refusée (déjà terminée ailleurs : annulée, échouée, enregistrée) : `stale` rend la génération enregistrée.
  const put = async (next) => {
    const r = await acct('/job/put', next)
    return r?.ok === false && r.job ? { stale: r.job } : {}
  }
  const st = await providerStatus(env, job)
  if (st.status === 'FAILED') return fail(st.failure)
  if (st.status !== 'COMPLETED') {
    const next = { ...job, status: st.status, ...(st.status === 'IN_PROGRESS' && !job.startedAt ? { startedAt: Date.now() } : {}) }
    if (next.status !== job.status) { const { stale } = await put(next); if (stale) return { job: stale } }
    return { job: next, queuePosition: st.queuePosition ?? 0, logs: (st.logs ?? []).slice(-3) }
  }
  const found = outputsOf(job.kind, st.result)
  if (!found.length) return fail('provider')
  // Copie dans R2 : un seul suivi à la fois s'en charge ; les autres voient « enregistrement » et réessaient.
  if (job.storingAt && Date.now() - job.storingAt < STORING) return { job: { ...job, status: 'IN_PROGRESS' }, logs: ['Enregistrement du résultat'] }
  // La prise est vérifiée par le Durable Object (jeton `storingBy`) : un autre suivi parti de la même copie est refusé et ne copie rien.
  if (env.FILES) { const { stale } = await put({ ...job, status: 'IN_PROGRESS', storingAt: Date.now(), storingBy: crypto.randomUUID() }); if (stale) return { job: stale } }
  const outputs = await storeOutputs({ bucket: env.FILES, origin, accountId, jobId: job.id, outputs: found })
  const next = { ...job, status: 'COMPLETED', outputs, finishedAt: Date.now(), storingAt: undefined, storingBy: undefined }
  const { stale } = await put(next)
  return { job: stale ?? next }
}

/** Jeton du webhook fal d'une génération : HMAC-SHA256 de « compte:génération » avec WEBHOOK_SECRET, en base64url. */
export async function webhookToken(secret, accountId, jobId) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${accountId}:${jobId}`)))
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Comparaison en temps constant de deux jetons. */
export function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
