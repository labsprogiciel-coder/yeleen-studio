/**
 * Sentry (erreurs de l'API et du Durable Object). Actif seulement si le secret SENTRY_DSN est réglé ; sinon rien n'est envoyé.
 * Rien de personnel : pas d'en-têtes (jeton Clerk), pas de corps (instructions), pas de paramètres d'adresse (jeton du webhook fal) ;
 * l'utilisateur n'est connu que par l'identifiant du compte.
 * Fil d'Ariane : pas de journaux de la console (ils citent des réponses de fournisseurs) ; des appels sortants (fetch), seulement la
 * méthode, l'adresse sans paramètres (celle de paygate porte le numéro de téléphone) et le statut.
 * Messages d'erreur : un numéro de téléphone peut seulement venir d'une réponse de paygate citée dans PaygateError (fal, Runware et
 * Higgsfield ne reçoivent pas de numéro). Les erreurs des fournisseurs le masquent déjà à la source (errorDetail de redact.js), ce
 * qui couvre aussi les journaux du Worker ; par sûreté, les messages qui arrivent ici repassent au même crible (`noPhone` : +226…,
 * %2B226…, 226…, numéro local seul) et un numéro devient « [numéro] ».
 */
import { noPhone } from './redact.js'

export function sentryOptions(env) {
  if (!env.SENTRY_DSN) return undefined
  return {
    dsn: env.SENTRY_DSN,
    environment: env.ENV ?? 'production',
    release: env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrub,
    beforeBreadcrumb: crumb,
    ...(env.SENTRY_TRANSPORT ? { transport: env.SENTRY_TRANSPORT } : {}), // tests seulement : envoi simulé
  }
}

const bare = (u) => (typeof u === 'string' ? u.split(/[?#]/)[0] : u)

/** Retire de l'événement ce qui peut contenir un secret ou le texte d'un utilisateur. */
export function scrub(event) {
  const r = event.request
  if (r) {
    if (r.url) r.url = bare(r.url)
    delete r.query_string
    delete r.headers
    delete r.cookies
    delete r.data
  }
  for (const ex of event.exception?.values ?? []) ex.value = noPhone(ex.value)
  if (typeof event.message === 'string') event.message = noPhone(event.message)
  if (event.logentry?.message) event.logentry.message = noPhone(event.logentry.message)
  return event
}

/**
 * Fil d'Ariane : les journaux de la console sont jetés ; un appel sortant (fetch, http) ne garde que sa méthode, son adresse sans
 * paramètres ni fragment et son statut (ni paramètres, ni corps). Les autres miettes perdent leur message s'il cite un numéro.
 */
export function crumb(b) {
  if (!b || b.category === 'console') return null
  if (b.type === 'http' || b.category === 'fetch' || b.category === 'xhr' || b.category === 'http') {
    const { message, data = {}, ...rest } = b
    const kept = { method: data.method, url: bare(data.url), status_code: data.status_code }
    return { ...rest, data: Object.fromEntries(Object.entries(kept).filter(([, v]) => v !== undefined)) }
  }
  return b.message === undefined ? b : { ...b, message: noPhone(b.message) }
}
