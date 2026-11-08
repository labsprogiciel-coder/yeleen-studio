/**
 * PostHog côté site (mesure d'audience et parcours) : actif seulement si VITE_POSTHOG_KEY est donnée à la construction
 * (`.env.production` pour le site publié). Comme Sentry, le SDK est chargé à part (import dynamique), après le premier affichage.
 *
 * Ce qui part : les pages vues (navigation de l'application comprise), les clics (autocapture), et quelques événements nommés
 * (`track`). Ce qui ne part pas : le texte des consignes et des champs (jamais lu par l'autocapture, jamais mis dans `track`),
 * les enregistrements de session (éteints ici), les adresses IP (anonymisées par le projet). Un compte n'est connu que par
 * l'identifiant Clerk ; les visiteurs non connectés n'ont pas de profil (`identified_only`).
 */
const key = import.meta.env.VITE_POSTHOG_KEY
const host = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com'
let user // dernier compte connu, appliqué dès que le SDK est prêt
let known = false // un compte a été identifié : à la déconnexion, on repart d'un visiteur anonyme

const sdk = key ? import('posthog-js').then(({ default: posthog }) => {
  posthog.init(key, {
    api_host: host,
    defaults: '2025-05-24', // pages vues suivies à chaque changement d'adresse (application à une page)
    person_profiles: 'identified_only',
    disable_session_recording: true,
    capture_exceptions: false, // les erreurs vont à Sentry
    sanitize_properties: (props) => {
      // Adresses sans paramètres (un lien de paiement ou un jeton peut s'y trouver).
      for (const k of ['$current_url', '$referrer', '$prev_pageview_pathname']) if (typeof props[k] === 'string') props[k] = props[k].split('?')[0]
      return props
    },
  })
  apply(posthog)
  return posthog
}).catch(() => null) : null

function apply(posthog) {
  if (user === undefined) return
  if (user) { posthog.identify(user); known = true } else if (known) { posthog.reset(); known = false }
}

/** Compte connecté (ou null) : seul son identifiant Clerk est envoyé. */
export function setAnalyticsUser(id) {
  user = id ?? null
  sdk?.then((posthog) => posthog && apply(posthog))
}

/** Événement nommé (envoyé dès que le SDK est prêt). Propriétés courtes et sans texte saisi : jamais de consigne. */
export function track(event, props) {
  sdk?.then((posthog) => posthog?.capture(event, props))
}
