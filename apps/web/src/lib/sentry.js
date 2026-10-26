/**
 * Sentry côté site : actif seulement si VITE_SENTRY_DSN est donnée à la construction. Le SDK est chargé à part (import dynamique),
 * après le premier affichage, et jamais sans DSN : il ne pèse rien sur le chargement de la page.
 * Rien de personnel : pas d'adresse IP, pas de journaux de la console (ils peuvent contenir une instruction), adresses sans
 * paramètres ; l'utilisateur n'est connu que par l'identifiant de son compte Clerk.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN
const bare = (u) => (typeof u === 'string' ? u.split('?')[0] : u)
let user // dernier compte connu, appliqué dès que le SDK est prêt

const sdk = dsn ? import('@sentry/react').then((Sentry) => {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) { event.request.url = bare(event.request.url); delete event.request.query_string; delete event.request.headers }
      return event
    },
    beforeBreadcrumb(b) {
      if (b.category === 'console') return null
      for (const k of ['url', 'to', 'from']) if (b.data?.[k]) b.data[k] = bare(b.data[k])
      return b
    },
  })
  if (user !== undefined) Sentry.setUser(user ? { id: user } : null)
  return Sentry
}).catch(() => null) : null

/** Signale une erreur attrapée (par l'écran d'erreur, voir Crash.jsx). */
export function reportError(error, componentStack) {
  sdk?.then((Sentry) => Sentry?.captureException(error, { contexts: { react: { componentStack } } }))
}

/** Compte connecté (ou null) : seul son identifiant est envoyé. */
export function setSentryUser(id) {
  user = id ?? null
  sdk?.then((Sentry) => Sentry?.setUser(user ? { id: user } : null))
}
