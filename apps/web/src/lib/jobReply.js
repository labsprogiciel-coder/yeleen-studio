/** Code d'échec affichable : un code que l'interface ne connaît pas (plus récent qu'elle) est présenté comme `provider`. */
export const knownFailure = (code, failures = {}) => (failures[code] ? code : 'provider')

/**
 * Réponse de l'API à un envoi (`POST /jobs`) → mise à jour de la génération locale. Le serveur peut rendre une génération déjà
 * enregistrée (nouvel essai avec la même clé) : échouée, elle l'est ici tout de suite, avec le remboursement du serveur ; sinon
 * le suivi habituel prend le relais (terminée ou annulée comprises, la génération locale étant encore active).
 */
export function createPatch(r, failures = {}, now = Date.now(), queued = false) {
  if (r?.status === 'FAILED') return { remoteId: r.jobId, status: 'FAILED', failure: knownFailure(r.failure, failures), refund: r.refund ?? 0, finishedAt: now }
  // Déjà démarrée chez le fournisseur dès l'envoi (Runware : jamais en file) : la génération locale passe en cours, pour que la
  // question d'arrêt ne promette pas un remboursement que le serveur ne fera pas. `queued` : l'état local, seul à pouvoir avancer.
  if (r?.status === 'IN_PROGRESS' && queued) return { remoteId: r.jobId, status: 'IN_PROGRESS' }
  return { remoteId: r?.jobId }
}

// Le serveur ne connaît pas la génération (404) : une fois peut être un hasard du déploiement, et une demande rendue par sa clé peut
// être encore en cours d'envoi (pas encore enregistrée). Trois fois de suite et depuis 30 s au moins : elle est perdue.
export const LOST_AFTER = 3
export const LOST_SPAN = 30_000
/** Après `misses` réponses 404 de suite depuis `since` : rien tant que ce n'est pas sûr, puis un échec `lost` (sans annoncer de remboursement). */
export function lostPatch(misses, since, now = Date.now()) {
  return misses < LOST_AFTER || now - since < LOST_SPAN ? null : { status: 'FAILED', failure: 'lost', refund: 0, finishedAt: now }
}

/**
 * Réponse de l'API à une annulation (`POST /jobs/:id/cancel`) → mise à jour de la génération locale, déjà passée CANCELED.
 * Le serveur rend la génération telle qu'il l'a enregistrée : terminée entre-temps (fichiers enregistrés, échec), elle reprend
 * ce statut ; encore active (ses fichiers sont en cours d'enregistrement), elle reprend son suivi. Pur : testable sans navigateur.
 */
export function cancelPatch(r, failures = {}) {
  if (!r?.status || r.status === 'CANCELED') return { refund: r?.refund }
  if (r.status === 'COMPLETED') return { status: 'COMPLETED', progress: 100, outputs: r.outputs, refund: r.refund ?? 0, logs: [{ msg: 'Terminée avant l’annulation' }] }
  if (r.status === 'FAILED') return { status: 'FAILED', failure: knownFailure(r.failure, failures), refund: r.refund ?? 0 }
  return { status: r.status, finishedAt: undefined, refund: 0 }
}
