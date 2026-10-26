/**
 * Sentry (erreurs de l'API et du Durable Object). Actif seulement si le secret SENTRY_DSN est réglé ; sinon rien n'est envoyé.
 * Rien de personnel : pas d'en-têtes (jeton Clerk), pas de corps (instructions), pas de paramètres d'adresse (jeton du webhook fal) ;
 * l'utilisateur n'est connu que par l'identifiant du compte.
 */
export function sentryOptions(env) {
  if (!env.SENTRY_DSN) return undefined
  return {
    dsn: env.SENTRY_DSN,
    environment: env.ENV ?? 'production',
    release: env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrub,
    ...(env.SENTRY_TRANSPORT ? { transport: env.SENTRY_TRANSPORT } : {}), // tests seulement : envoi simulé
  }
}

/** Retire de l'événement ce qui peut contenir un secret ou le texte d'un utilisateur. */
export function scrub(event) {
  const r = event.request
  if (r) {
    if (r.url) r.url = r.url.split('?')[0]
    delete r.query_string
    delete r.headers
    delete r.cookies
    delete r.data
  }
  return event
}
