/**
 * Texte d'une réponse d'erreur d'un fournisseur, pour le message d'une erreur (journaux du Worker, Sentry) : les champs qui
 * renvoient l'entrée reçue (`input` des erreurs de validation de fal, consignes, numéro…) sont retirés, et tout ce qui ressemble à
 * un numéro de téléphone devient « [numéro] » (`noPhone`), y compris dans un corps texte (page d'erreur d'un mandataire qui cite
 * l'adresse appelée) ou dans un champ libre (`message`, `detail`). Le corps complet reste dans `error.body`, lu par le code (refus
 * pour contenu), jamais journalisé.
 */
const ECHOED = new Set(['input', 'prompt', 'positivePrompt', 'negativePrompt', 'negative_prompt', 'text', 'phone', 'msisdn', 'email'])

export function errorDetail(body) {
  if (typeof body === 'string') return noPhone(body)
  return noPhone(JSON.stringify(body, (k, v) => (ECHOED.has(k) ? '[retiré]' : v)) ?? '')
}

/**
 * Numéro de téléphone sous toutes les formes où il peut se trouver dans un message : « +22670123456 », « %2B22670123456 » (dans
 * une adresse), « 0022670123456 », « 22670123456 », ou le numéro local seul (8 chiffres au Burkina, 9 au Sénégal, 10 en Côte
 * d'Ivoire : voir TOPUP_COUNTRIES), chiffres groupés par espaces ou points permis. Soit une suite isolée de 8 à 10 chiffres, précédée
 * ou non de l'indicatif 221, 225 ou 226 et de « + », « %2B » ou « 00 ». Une suite plus longue sans indicatif (horodatage en
 * millisecondes) et les identifiants qui mêlent lettres et chiffres (UUID, `job_…`) ne sont pas touchés ; un horodatage en secondes
 * (10 chiffres) l'est : perte acceptée, mieux vaut trop masquer que pas assez.
 */
const PHONE = /(?<![\w%+.])(?:\+|%2[bB]|00)?(?:22[156][ .]?)?(?:\d[ .]?){7,9}\d(?!\w)/g
export const noPhone = (s) => (typeof s === 'string' ? s.replace(PHONE, '[numéro]') : s)
