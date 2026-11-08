/**
 * Client minimal de l'API Higgsfield (REST), sans dépendance : il tourne tel quel dans un Worker.
 * Une génération : POST https://api.higgsfield.ai/<point d'accès> avec l'entrée JSON, puis GET /requests/<id>/status jusqu'à un état
 * final (completed, failed, nsfw, canceled). Clé : `HIGGSFIELD_KEY`, au format « KEY_ID:KEY_SECRET » (console Higgsfield).
 * Les échecs (failed) et refus (nsfw) ne sont pas facturés par Higgsfield ; une demande encore en file peut être annulée.
 * Docs : https://docs.higgsfield.ai/docs/quickstart.md, …/concepts/requests.md, …/concepts/errors.md
 */
const API = 'https://api.higgsfield.ai'

export class HiggsfieldError extends Error {
  constructor(status, body, where) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body)
    super(`higgsfield ${where} ${status}: ${(detail ?? '').slice(0, 300)}`)
    this.status = status
    this.body = body
    this.where = where
  }
  /** Refus pour contenu (état « nsfw » ou message de modération) : inutile de réessayer tel quel. */
  get isContentPolicy() {
    const text = JSON.stringify(this.body ?? '').toLowerCase()
    return /nsfw|content_policy|moderat|safety|inappropriate/.test(text)
  }
}

const parse = async (res) => {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

// Les sorties n'ont pas toujours de type : on le déduit de l'extension (la copie dans R2 en a besoin pour nommer le fichier).
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }
const typed = (f, fallback) => f?.url && ({ url: f.url, content_type: f.content_type ?? TYPES[f.url.split('?')[0].split('.').pop()?.toLowerCase()] ?? fallback })

/** Résultat d'une demande terminée, au format d'une réponse fal ({ images: [...] } ou { video }) pour la suite (copie dans R2). */
export function resultOf(body) {
  const out = body?.payload ?? body ?? {}
  if (Array.isArray(out.images) && out.images.length) return { images: out.images.map((f) => typed(f, 'image/png')).filter(Boolean) }
  if (out.video?.url) return { video: typed(out.video, 'video/mp4') }
  return {}
}

export function higgsfieldClient({ key, fetch: f = fetch }) {
  if (!key) throw new Error('HIGGSFIELD_KEY manquante')
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }
  return {
    /**
     * Lance une génération. `idempotencyKey` (l'identifiant de la génération chez nous) : un envoi répété après une coupure ne la
     * lance pas deux fois. Rend { requestId, statusUrl, cancelUrl }.
     */
    async submit(endpoint, input, { idempotencyKey } = {}) {
      const res = await f(`${API}/${endpoint}`, { method: 'POST', headers: { ...headers, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: JSON.stringify(input) })
      const body = await parse(res)
      if (!res.ok || !body?.request_id) throw new HiggsfieldError(res.status, body, 'submit')
      return { requestId: body.request_id, statusUrl: body.status_url ?? `${API}/requests/${body.request_id}/status`, cancelUrl: body.cancel_url ?? `${API}/requests/${body.request_id}/cancel` }
    },
    /**
     * État d'une demande, au format du suivi fal : { status: IN_QUEUE | IN_PROGRESS | COMPLETED | FAILED, result?, error? }.
     * Un état final d'échec rend FAILED ; une erreur de la requête (réseau, clé, surcharge) est levée : on réessaiera.
     */
    async poll(requestId) {
      const res = await f(`${API}/requests/${encodeURIComponent(requestId)}/status`, { headers })
      const body = await parse(res)
      // 404 : demande inconnue de ce compte (jamais reçue, ou supprimée) ; elle ne reviendra pas : échec, donc remboursement.
      if (res.status === 404) return { status: 'FAILED', error: new HiggsfieldError(404, body, 'status') }
      if (!res.ok) throw new HiggsfieldError(res.status, body, 'status') // erreur passagère (réseau, 5xx, 429) : on réessaiera
      switch (body?.status) {
        case 'queued': return { status: 'IN_QUEUE' }
        case 'in_progress': return { status: 'IN_PROGRESS' }
        case 'completed': return { status: 'COMPLETED', result: resultOf(body) }
        case 'nsfw': return { status: 'FAILED', error: new HiggsfieldError(200, { status: 'nsfw' }, 'task') }
        case 'failed': case 'canceled': return { status: 'FAILED', error: new HiggsfieldError(200, body, 'task') }
        default: return { status: 'IN_PROGRESS' } // état inconnu : on continue d'attendre
      }
    },
    /** Annule une demande encore en file (remboursée par Higgsfield) ; déjà commencée (400) ou finie (409) : rien à faire. */
    async cancel(cancelUrl) {
      const res = await f(cancelUrl, { method: 'POST', headers })
      if (!res.ok && res.status !== 400 && res.status !== 409) throw new HiggsfieldError(res.status, await parse(res), 'cancel')
    },
  }
}
