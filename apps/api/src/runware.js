/**
 * Client minimal de l'API Runware (REST), sans dépendance : il tourne tel quel dans un Worker.
 * Une génération vidéo est une tâche `videoInference` asynchrone : on l'envoie avec un identifiant (`taskUUID`) choisi ici, puis on
 * interroge `getResponse` avec ce même identifiant jusqu'à `success` ou `error`. Runware ne propose pas d'annulation.
 * Docs : https://runware.ai/docs/models-api/task-polling et https://runware.ai/docs/models-api/errors
 */
const API = 'https://api.runware.ai/v1'

export class RunwareError extends Error {
  constructor(status, body, where) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body)
    super(`runware ${where} ${status}: ${detail.slice(0, 300)}`)
    this.status = status
    this.body = body
    this.where = where
  }
  /** Refus pour contenu (filtre de sécurité du fournisseur) : inutile de réessayer tel quel. */
  get isContentPolicy() {
    const text = JSON.stringify(this.body ?? '').toLowerCase()
    return /content_policy|contentpolicy|safety|nsfw|moderat|inappropriate/.test(text)
  }
}

const parse = async (res) => {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

// Refus pour capacité (https://runware.ai/docs/models-api/rate-limits) : la tâche n'est pas entrée dans la file, la renvoyer ne la
// lance pas deux fois. 429 : file du modèle pleine ou limite de l'organisation ; 503 : capacité momentanément insuffisante.
const BUSY = new Set(['serviceOverloaded', 'inferenceRateLimitExceeded'])
const busy = (r) => r.status === 429 || r.status === 503 || r.errors.some((e) => BUSY.has(e.code))
const RETRIES = 3 // au plus 4 envois
const MAX_WAIT = 8 // secondes par attente : l'utilisateur attend la réponse de « Générer »

/** Attente avant le prochain envoi : celle que Runware indique (en-tête Retry-After ou champ retryAfter), sinon 1, 2, 4 s. */
export function retryDelay(r, attempt) {
  const hinted = Number(r.retryAfter ?? r.errors.find((e) => typeof e.retryAfter === 'number')?.retryAfter)
  const secs = Number.isFinite(hinted) && hinted > 0 ? hinted : 2 ** attempt
  return Math.min(secs, MAX_WAIT) * 1000
}

export function runwareClient({ key, fetch: f = fetch, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) }) {
  if (!key) throw new Error('RUNWARE_KEY manquante')
  const send = async (tasks, where) => {
    const res = await f(API, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(tasks) })
    const body = await parse(res)
    return { ok: res.ok, status: res.status, body, retryAfter: res.headers?.get?.('Retry-After'), data: Array.isArray(body?.data) ? body.data : [], errors: Array.isArray(body?.errors) ? body.errors : [] }
  }
  /** Envoi qui réessaie tant que Runware refuse pour capacité, avec l'attente qu'il demande. */
  const sendRetrying = async (tasks, where) => {
    for (let attempt = 0; ; attempt++) {
      const r = await send(tasks, where)
      if (!busy(r) || attempt === RETRIES) return r
      await sleep(retryDelay(r, attempt))
    }
  }
  return {
    /**
     * Lance une vidéo ; `task` : modèle et paramètres (voir runwareInput). Rend l'identifiant à interroger ensuite. Un refus pour
     * capacité est réessayé (même taskUUID) avant d'abandonner ; le suivi (poll) n'en a pas besoin, il repasse de lui-même.
     */
    async submit(task) {
      const taskUUID = crypto.randomUUID()
      const r = await sendRetrying([{ ...task, taskType: 'videoInference', taskUUID, deliveryMethod: 'async', outputType: 'URL', outputFormat: 'MP4', includeCost: true }], 'submit')
      if (!r.ok || r.errors.length) throw new RunwareError(r.status, r.errors.length ? r.errors : r.body, 'submit')
      return { taskUUID, requestId: taskUUID } // requestId : copié dans D1 (jobs.request_id), comme celui de fal
    },
    /**
     * État d'une tâche, au format du suivi fal : { status: IN_PROGRESS | COMPLETED | FAILED, progress?, result?, cost?, error? }.
     * `result` a la forme d'une réponse fal ({ video: { url, content_type } }) pour que la suite (copie dans R2) ne change pas.
     * Une erreur de la tâche elle-même rend FAILED ; une erreur de la requête (réseau, clé, surcharge) est levée : on réessaiera.
     */
    async poll(taskUUID) {
      const r = await send([{ taskType: 'getResponse', taskUUID }], 'status')
      const failed = r.errors.filter((e) => e.taskUUID === taskUUID)
      if (failed.length) return { status: 'FAILED', error: new RunwareError(r.status, failed, 'task') }
      if (!r.ok || r.errors.length) throw new RunwareError(r.status, r.errors.length ? r.errors : r.body, 'status')
      const mine = r.data.filter((d) => d.taskUUID === taskUUID)
      const done = mine.find((d) => d.status === 'success' && d.videoURL)
      if (done) return { status: 'COMPLETED', cost: done.cost, result: { video: { url: done.videoURL, content_type: 'video/mp4' } } }
      const err = mine.find((d) => d.status === 'error')
      if (err) return { status: 'FAILED', error: new RunwareError(r.status, err.error ?? err, 'task') }
      return { status: 'IN_PROGRESS', progress: mine.find((d) => typeof d.progress === 'number')?.progress }
    },
  }
}
