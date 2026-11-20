/**
 * Réponse de l'API à une annulation (`POST /jobs/:id/cancel`) → mise à jour de la génération locale, déjà passée CANCELED.
 * Le serveur rend la génération telle qu'il l'a enregistrée : terminée entre-temps (fichiers enregistrés, échec), elle reprend
 * ce statut ; encore active (ses fichiers sont en cours d'enregistrement), elle reprend son suivi. Pur : testable sans navigateur.
 */
export function cancelPatch(r, failures = {}) {
  if (!r?.status || r.status === 'CANCELED') return { refund: r?.refund }
  if (r.status === 'COMPLETED') return { status: 'COMPLETED', progress: 100, outputs: r.outputs, refund: r.refund ?? 0, logs: [{ msg: 'Terminée avant l’annulation' }] }
  if (r.status === 'FAILED') return { status: 'FAILED', failure: failures[r.failure] ? r.failure : 'provider', refund: r.refund ?? 0 }
  return { status: r.status, finishedAt: undefined, refund: 0 }
}
