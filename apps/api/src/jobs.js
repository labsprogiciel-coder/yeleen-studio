import { FalError, falClient } from './fal.js'
import { outputsOf } from './inputs.js'
import { runwareClient } from './runware.js'
import { storeOutputs } from './storage.js'

/**
 * Suivi d'une génération, partagé par les trois chemins qui la font avancer : l'interrogation de l'interface (`GET /jobs/:id`),
 * le webhook de fal (`/webhooks/fal`) et le réveil du Durable Object du compte (`alarm`, toutes les minutes tant qu'une génération
 * est active). Ainsi une génération se termine, est copiée dans R2 ou remboursée même si l'utilisateur a fermé la page.
 */
export const isActive = (job) => job.status === 'IN_QUEUE' || job.status === 'IN_PROGRESS'

const STORING = 60_000 // une copie dans R2 commencée depuis moins longtemps est en cours ailleurs

/**
 * État d'une génération chez son fournisseur, au même format pour fal et Runware :
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
  const client = falClient({ key: env.FAL_KEY })
  const st = await client.status(job.statusUrl)
  if (st.status !== 'COMPLETED') return st
  try {
    return { status: 'COMPLETED', result: await client.result(job.responseUrl) }
  } catch (e) {
    console.error('résultat fal', e.message)
    return { status: 'FAILED', failure: e instanceof FalError && e.isContentPolicy ? 'moderation' : 'provider' }
  }
}

/**
 * Fait avancer une génération active d'un pas. `acct(path, body)` appelle le Durable Object du compte (POST JSON) ;
 * `origin` sert aux adresses /files des copies dans R2. Un échec rembourse (une seule fois : le remboursement est idempotent).
 * Rend { job, queuePosition?, logs?, balance? } ; une erreur passagère du fournisseur est levée (on réessaiera).
 */
export async function advanceJob({ env, acct, accountId, origin, job }) {
  const fail = async (failure) => {
    const back = await acct('/refund', { jobId: job.id })
    const next = { ...job, status: 'FAILED', failure, refund: back.refunded ?? job.cost, finishedAt: Date.now() }
    await acct('/job/put', next)
    return { job: next, balance: back.balance }
  }
  const st = await providerStatus(env, job)
  if (st.status === 'FAILED') return fail(st.failure)
  if (st.status !== 'COMPLETED') {
    const next = { ...job, status: st.status, ...(st.status === 'IN_PROGRESS' && !job.startedAt ? { startedAt: Date.now() } : {}) }
    if (next.status !== job.status) await acct('/job/put', next)
    return { job: next, queuePosition: st.queuePosition ?? 0, logs: (st.logs ?? []).slice(-3) }
  }
  const found = outputsOf(job.kind, st.result)
  if (!found.length) return fail('provider')
  // Copie dans R2 : un seul suivi à la fois s'en charge ; les autres voient « enregistrement » et réessaient.
  if (job.storingAt && Date.now() - job.storingAt < STORING) return { job: { ...job, status: 'IN_PROGRESS' }, logs: ['Enregistrement du résultat'] }
  if (env.FILES) await acct('/job/put', { ...job, status: 'IN_PROGRESS', storingAt: Date.now() })
  const outputs = await storeOutputs({ bucket: env.FILES, origin, accountId, jobId: job.id, outputs: found })
  const next = { ...job, status: 'COMPLETED', outputs, finishedAt: Date.now(), storingAt: undefined }
  await acct('/job/put', next)
  return { job: next }
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
