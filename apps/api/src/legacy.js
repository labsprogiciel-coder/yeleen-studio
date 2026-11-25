/**
 * Fin des anciennes formes gardées pendant le passage au numéro, à l'e-mail et au compte hors des adresses : GET /topups/options
 * (numéro dans l'adresse), GET /admin/users?q= (texte cherché dans l'adresse) et l'ancienne adresse du webhook fal (`a`, `j`, `t` :
 * le compte en clair). Elles ne servent qu'à un site chargé avant le changement et aux générations fal déjà en route (quelques
 * heures au plus) ; à partir de cette date l'API les refuse d'elle-même (410, ou 401 pour le webhook : le réveil du compte termine
 * alors la génération). Le code qui les accepte, et le repli du site (lib/api.js, `postOrLegacy`), sont à retirer à la version
 * suivante.
 */
export const LEGACY_UNTIL = Date.parse('2026-12-31T00:00:00Z')

export const legacyOpen = (now = Date.now()) => now < LEGACY_UNTIL
