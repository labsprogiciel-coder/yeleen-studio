/**
 * PostHog côté site (mesure d'audience et parcours) : actif seulement si VITE_POSTHOG_KEY est donnée à la construction
 * (`.env.production` pour le site publié). Comme Sentry, le SDK est chargé à part (import dynamique), après le premier affichage.
 * Les options sont dans telemetry.js (testées seules).
 *
 * Ce qui part :
 * - les pages vues (navigation de l'application comprise) et les départs de page, avec l'adresse sans paramètres ni fragment
 *   (`$current_url`, `$referrer`, `$initial_current_url`… : un lien de paiement ou un jeton peut s'y trouver) ;
 * - les clics (autocapture, clics répétés compris, et clics sans effet si le projet PostHog les allume) : type d'événement, balise
 *   de l'élément cliqué et de ses parents, rang parmi ses voisins, page, position. Ni texte (`mask_all_text`) ni attributs
 *   (`mask_all_element_attributes` : ni alt, aria-label, title, href, classes, identifiants), jamais la valeur d'un champ ni le texte
 *   copié. Seule exception du SDK : un attribut `data-ph-capture-attribute-<nom>` serait copié malgré le masque ; le site n'en a
 *   aucun, et `before_send` jette de toute façon toute propriété d'un clic qui n'est pas celle du SDK (`$…`) ;
 * - quelques événements nommés (`track`) : propriétés courtes, jamais une consigne ;
 * - les propriétés ajoutées par le SDK : navigateur, système, appareil, taille d'écran, langue, identifiants de visite et de session.
 * Ce qui ne part pas : aucun clic relevé sur l'administration (/admin, où l'on voit e-mails et numéros des autres comptes : exclue
 * de l'autocapture et jetée par `before_send`), ni carte de chaleur ni mesures de performance (web vitals, temps réseau : éteintes
 * ici quel que soit le réglage du projet, car leurs adresses gardent leurs paramètres), les enregistrements de session (éteints),
 * les erreurs (Sentry), les adresses IP (anonymisées par le projet). Un compte n'est connu que par l'identifiant Clerk ; les
 * visiteurs non connectés n'ont pas de profil (`identified_only`). `optOut` / `optIn` arrêtent ou reprennent tout envoi depuis ce
 * navigateur (choix gardé par le SDK).
 */
import { posthogOptions } from './telemetry.js'

const key = import.meta.env.VITE_POSTHOG_KEY
const host = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com'
let user // dernier compte connu, appliqué dès que le SDK est prêt
let known = false // un compte a été identifié : à la déconnexion, on repart d'un visiteur anonyme

const sdk = key ? import('posthog-js').then(({ default: posthog }) => {
  posthog.init(key, posthogOptions(host))
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

/** Plus aucun envoi depuis ce navigateur (le SDK garde ce choix). Prêt pour le réglage « mesure d'audience », pas encore branché. */
export function optOut() {
  sdk?.then((posthog) => posthog?.opt_out_capturing())
}

/** Reprend les envois après `optOut`. */
export function optIn() {
  sdk?.then((posthog) => posthog?.opt_in_capturing())
}
