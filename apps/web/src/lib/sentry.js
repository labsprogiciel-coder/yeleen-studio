/**
 * Sentry côté site : actif seulement si VITE_SENTRY_DSN est donnée à la construction. Le SDK est chargé à part (import dynamique),
 * après le premier affichage, et jamais sans DSN : il ne pèse rien sur le chargement de la page.
 * Rien de personnel : pas d'adresse IP, pas de journaux de la console (ils peuvent contenir une instruction), adresses sans
 * paramètres, appels réseau sans corps, clics sans la valeur des attributs de l'élément (alt, aria-label, title : une consigne, un
 * e-mail en administration) ; l'utilisateur n'est connu que par l'identifiant de son compte Clerk. Règles dans telemetry.js.
 */
import { sentryBreadcrumb, sentryEvent } from './telemetry.js'

const dsn = import.meta.env.VITE_SENTRY_DSN
let user // dernier compte connu, appliqué dès que le SDK est prêt

const sdk = dsn ? import('@sentry/react').then((Sentry) => {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: sentryEvent,
    beforeBreadcrumb: sentryBreadcrumb,
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
