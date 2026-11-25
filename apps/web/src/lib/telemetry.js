/**
 * Règles de confidentialité de PostHog et Sentry côté site, sans dépendance (testées seules, voir test/telemetry.test.js) :
 * posthog.js et sentry.js les appliquent. Ce qui part et ce qui ne part pas est décrit en tête de ces deux fichiers.
 */

/** Adresse sans paramètres ni fragment (un lien de paiement, un jeton ou une recherche peuvent s'y trouver). */
export const bareUrl = (u) => (typeof u === 'string' ? u.split(/[?#]/)[0] : u)

// Administration : on y voit les e-mails, numéros et consignes des autres comptes ; rien n'y est relevé au clic.
const ADMIN_PATH = /^\/admin(?:[/?#]|$)/
const ADMIN_URL = '^https?://[^/]+/admin(?:[/?#]|$)' // pour `autocapture.url_ignorelist`, comparé à l'adresse complète
const pathOf = (u) => {
  if (typeof u !== 'string') return null
  try { return new URL(u, 'http://x').pathname } catch { return null }
}
export const isAdminUrl = (u) => ADMIN_PATH.test(pathOf(u) ?? '')

// Événements relevés sur la page elle-même (clics, clics répétés, clics sans effet, copie, carte de chaleur) : jamais en administration.
const PAGE_EVENTS = new Set(['$autocapture', '$rageclick', '$dead_click', '$copy_autocapture', '$$heatmap'])
// Propriétés qui portent un texte ou une valeur de la page : jamais envoyées, même si une option du SDK venait à les remplir.
const PAGE_TEXT = ['$el_text', '$selected_content', '$input_value', '$external_click_url']
const URL_KEY = /url|referrer|pathname/i
// Seules propriétés sans « $ » gardées sur un clic : les autres viennent d'attributs `data-ph-capture-attribute-<nom>` de la page, que
// le SDK copie même avec `mask_all_element_attributes` (aucun dans le site aujourd'hui ; jetées si l'on en ajoutait).
const CLICK_KEEP = new Set(['token', 'distinct_id'])

const cleanProps = (p) => {
  if (!p || typeof p !== 'object') return p
  for (const k of Object.keys(p)) if (typeof p[k] === 'string' && URL_KEY.test(k)) p[k] = bareUrl(p[k])
  for (const k of PAGE_TEXT) delete p[k]
  return p
}

/**
 * `before_send` de PostHog : null (rien ne part) pour une carte de chaleur ou un événement relevé sur une page d'administration ;
 * sinon l'événement avec ses adresses sans paramètres (propriétés de l'événement et du profil : `$current_url`, `$referrer`,
 * `$initial_current_url`…) et, pour un clic, sans propriété venue d'un attribut `data-ph-capture-attribute-*`.
 */
export function cleanAnalyticsEvent(event) {
  if (!event) return event
  // Carte de chaleur : ses points sont rangés par adresse complète (paramètres compris) et peuvent partir d'une autre page que celle
  // où ils ont été relevés (envoi groupé) ; éteinte dans les options, jetée ici si le SDK l'envoyait quand même.
  if (event.event === '$$heatmap') return null
  const p = event.properties ?? {}
  if (PAGE_EVENTS.has(event.event) && (isAdminUrl(p.$current_url) || isAdminUrl(p.$pathname))) return null
  if (PAGE_EVENTS.has(event.event)) for (const k of Object.keys(p)) if (!k.startsWith('$') && !CLICK_KEEP.has(k)) delete p[k]
  cleanProps(event.properties)
  cleanProps(event.$set)
  cleanProps(event.$set_once)
  if (event.properties?.$set) cleanProps(event.properties.$set)
  if (event.properties?.$set_once) cleanProps(event.properties.$set_once)
  return event
}

/** Options de posthog.init (sans la clé). Voir posthog.js pour ce qu'elles laissent partir. */
export function posthogOptions(host) {
  return {
    api_host: host,
    defaults: '2025-05-24', // pages vues suivies à chaque changement d'adresse (application à une page)
    person_profiles: 'identified_only',
    disable_session_recording: true,
    capture_exceptions: false, // les erreurs vont à Sentry
    // Clics : élément, position et page seulement ; ni son texte (consigne en `alt`, bouton…) ni ses attributs (aria-label, title, href, classes).
    mask_all_text: true,
    mask_all_element_attributes: true,
    autocapture: {
      url_ignorelist: [ADMIN_URL], // administration : aucun clic relevé (et `cleanAnalyticsEvent` les jette s'il en partait)
      capture_copied_text: false,
      capture_value_css_selector_allowlist: [], // jamais la valeur d'un champ
    },
    // Ni carte de chaleur (points rangés par adresse complète, paramètres compris), ni mesures de performance (web vitals, temps
    // réseau : adresses dans des objets imbriqués) : éteintes ici quel que soit le réglage du projet PostHog.
    capture_heatmaps: false,
    capture_performance: false,
    property_denylist: PAGE_TEXT,
    before_send: cleanAnalyticsEvent,
  }
}

/** `beforeSend` de Sentry : adresse sans paramètres ; ni en-têtes, ni cookies, ni corps. */
export function sentryEvent(event) {
  const r = event?.request
  if (r) {
    r.url = bareUrl(r.url)
    delete r.query_string
    delete r.headers
    delete r.cookies
    delete r.data
  }
  return event
}

/**
 * `beforeBreadcrumb` de Sentry : pas de journaux de la console (ils peuvent contenir une consigne) ; un appel réseau ne garde que sa
 * méthode, son adresse sans paramètres et son statut ; un clic ou une saisie garde l'élément sans la valeur de ses attributs
 * (Sentry y met aria-label, title et alt : une consigne, un e-mail en administration) ; une navigation, ses adresses sans paramètres.
 */
export function sentryBreadcrumb(b) {
  if (!b || b.category === 'console') return null
  if (b.type === 'http' || b.category === 'fetch' || b.category === 'xhr') {
    const { message, data = {}, ...rest } = b
    const kept = { method: data.method, url: bareUrl(data.url), status_code: data.status_code }
    return { ...rest, data: Object.fromEntries(Object.entries(kept).filter(([, v]) => v !== undefined)) }
  }
  if (typeof b.category === 'string' && b.category.startsWith('ui.') && typeof b.message === 'string') {
    b = { ...b, message: b.message.replace(/\[([\w:-]+)=(?:"[^"]*"|'[^']*'|[^\]]*)\]/g, '[$1]') }
  }
  if (b.data) {
    const data = { ...b.data }
    for (const k of ['url', 'to', 'from']) if (data[k]) data[k] = bareUrl(data[k])
    b = { ...b, data }
  }
  return b
}
