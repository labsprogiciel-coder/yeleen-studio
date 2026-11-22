/**
 * Question posée avant d'arrêter une génération (✕) : le titre selon ce qui est généré, et une phrase sur les cauris qui dit ce que
 * l'arrêt fera vraiment (voir `cancel` dans lib/jobs.jsx) :
 *   - encore en file : tout est rendu ;
 *   - déjà en cours chez le fournisseur (génération réelle) : rien n'est remboursé ;
 *   - en cours dans le moteur simulé : seule la part non consommée est rendue ;
 *   - génération réelle encore en cours d'envoi (pas d'identifiant du serveur) : son état est inconnu, certains fournisseurs la
 *     démarrent dès l'envoi ; la phrase ne promet donc rien (`refund` 'unknown').
 * `label(n)` écrit un montant (« 41,4 cauris »). Rend `{ title, before, amount, after, refund }` : le montant s'affiche en gras
 * entre `before` et `after` ; `refund` vaut 'full', 'none' ou 'partial'. Pur : testable sans navigateur.
 */
const FORMS = {
  video: { what: 'cette vidéo', queued: 'Elle n’a pas encore commencé', running: 'Elle est déjà en cours', ifStarted: 'Si elle a déjà commencé' },
  image: { what: 'cette image', queued: 'Elle n’a pas encore commencé', running: 'Elle est déjà en cours', ifStarted: 'Si elle a déjà commencé' },
  images: { what: 'ces images', queued: 'Elles n’ont pas encore commencé', running: 'Elles sont déjà en cours', ifStarted: 'Si elles ont déjà commencé' },
  audio: { what: 'cet audio', queued: 'Il n’a pas encore commencé', running: 'Il est déjà en cours', ifStarted: 'S’il a déjà commencé' },
  other: { what: 'cette génération', queued: 'Elle n’a pas encore commencé', running: 'Elle est déjà en cours', ifStarted: 'Si elle a déjà commencé' },
}

function form(job) {
  if (job.spec?.live?.kind === 'tool') return FORMS.other // un outil : on ne présume pas de ce qu'il produit
  const many = (job.count ?? 1) > 1
  if (job.kind === 'image') return many ? FORMS.images : FORMS.image
  return (!many && FORMS[job.kind]) || FORMS.other
}

export function stopQuestion(job, label = (n) => `${n} cauris`) {
  const f = form(job)
  const amount = label(job.cost)
  const plural = job.cost >= 2 // « 1 cauri », « 1,5 cauri » : le singulier (voir jetonLabel)
  const title = `Arrêter ${f.what} ?`
  if (job.live && !job.remoteId && job.status === 'IN_QUEUE') {
    return plural
      ? { title, before: `${f.ifStarted}, vos `, amount, after: ' ne seront pas remboursés.', refund: 'unknown' }
      : { title, before: `${f.ifStarted}, votre paiement de `, amount, after: ' ne sera pas remboursé.', refund: 'unknown' }
  }
  if (job.status === 'IN_QUEUE') {
    return plural
      ? { title, before: `${f.queued} : vos `, amount, after: ' vous seront rendus.', refund: 'full' }
      : { title, before: `${f.queued} : votre paiement de `, amount, after: ' vous sera rendu.', refund: 'full' }
  }
  if (job.live) {
    return plural
      ? { title, before: `${f.running} : vos `, amount, after: ' ne seront pas remboursés.', refund: 'none' }
      : { title, before: `${f.running} : votre paiement de `, amount, after: ' ne sera pas remboursé.', refund: 'none' }
  }
  return plural
    ? { title, before: `${f.running} : seule la part non consommée de vos `, amount, after: ' vous sera rendue.', refund: 'partial' }
    : { title, before: `${f.running} : seule la part non consommée de votre paiement de `, amount, after: ' vous sera rendue.', refund: 'partial' }
}
