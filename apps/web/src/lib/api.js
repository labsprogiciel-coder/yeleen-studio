/**
 * Client de l'API du studio (apps/api). Le navigateur ne parle jamais à fal : tout passe par l'API,
 * qui calcule le prix, débite les jetons, appelle fal et rembourse en cas d'échec.
 * Sans `VITE_API_URL`, `apiEnabled` est faux et l'application reste sur le moteur simulé.
 */
const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '')
export const apiEnabled = Boolean(BASE)
/** Adresse publique d'un fichier du bucket servi par l'API (`/files/<clé>`), ou null sans API. */
export const fileUrl = (key) => (BASE ? `${BASE}/files/${key}` : null)

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`)
    this.status = status
    this.body = body ?? {}
  }
}

// Fournisseur du jeton de session Clerk (installé par lib/auth.jsx) ; absent en développement sans Clerk.
let tokenGetter = null
export const setTokenGetter = (fn) => { tokenGetter = fn }
async function authHeader() {
  if (!tokenGetter) return {}
  try {
    const token = await tokenGetter()
    return token ? { authorization: `Bearer ${token}` } : {}
  } catch { return {} } // jeton introuvable : l'API répondra 401 et l'interface invitera à se reconnecter
}

async function request(path, init) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, { headers: { 'content-type': 'application/json', ...(await authHeader()) }, ...init })
  } catch {
    throw new ApiError(0, { error: 'unreachable' }) // API éteinte ou hors réseau
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body)
  return body
}

export const api = {
  wallet: () => request('/wallet'),
  createJob: (spec) => request('/jobs', { method: 'POST', body: JSON.stringify(spec) }),
  job: (id) => request(`/jobs/${id}`),
  cancelJob: (id) => request(`/jobs/${id}/cancel`, { method: 'POST' }),
  /** Recharges Mobile Money : moyen disponible pour ce numéro, lancement (ou nouvel essai avec `reference` et `preAuthCode`), suivi, historique. */
  topupOptions: (q) => request(`/topups/options?${new URLSearchParams(q)}`),
  createTopup: (spec) => request('/topups', { method: 'POST', body: JSON.stringify(spec) }),
  topup: (reference) => request(`/topups/${encodeURIComponent(reference)}`),
  topups: () => request('/topups'),
  /** Ma bibliothèque (fichiers générés et importés, gardés par l'API), favoris des deux bibliothèques, historique des jetons. */
  assets: (q = {}) => request(`/assets?${new URLSearchParams(q)}`),
  deleteAsset: (id) => request(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  favorites: () => request('/favorites'),
  /** Vidéos à refaire (Modèles), publiques. */
  templates: () => request('/templates'),
  setFavorite: (scope, id, on) => request(`/favorites/${scope}/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE' }),
  ledger: (q = {}) => request(`/ledger?${new URLSearchParams(q)}`),
  /** « Améliorer » : réécrit l'instruction pour le modèle choisi ({ text, kind: 'video' | 'image', modelId }) ; gratuit, quota par jour. */
  enhance: (spec) => request('/enhance', { method: 'POST', body: JSON.stringify(spec) }),
  /** Dépose un fichier d'entrée (image, audio) chez le fournisseur ; renvoie son adresse. */
  upload: async (file) => (await sendFile(`/uploads?name=${encodeURIComponent(file.name)}`, file)).url,
  /** Importe un fichier dans Ma bibliothèque (gardé dans R2, retrouvé sur tous les appareils) ; renvoie l'asset du serveur. */
  importAsset: async (file, meta = {}) => (await sendFile(`/assets?${new URLSearchParams(Object.entries(meta).filter(([, v]) => v != null))}`, file)).asset,

  /**
   * Administration (réservée aux comptes listés dans ADMIN_USER_IDS côté API, qui répond 403 aux autres). Chaque action porte
   * dans son corps JSON une clé d'idempotence `adm_…` (une par ouverture de fenêtre) et un motif ; l'en-tête resterait perdu (voir `request`).
   */
  adminMe: () => request('/admin/me'),
  adminUsers: (q = '') => request(`/admin/users?${new URLSearchParams({ q })}`),
  adminUser: (uid) => request(`/admin/users/${enc(uid)}`),
  adminAdjust: (uid, { key, direction, amount, reason }) => post(`/admin/users/${enc(uid)}/adjust`, { key, direction, amount, reason }),
  adminRefund: (uid, jobId, { key, amount, reason }) => post(`/admin/users/${enc(uid)}/jobs/${enc(jobId)}/refund`, { key, ...(amount != null ? { amount } : {}), reason }),
  adminCancel: (uid, jobId, { key, reason }) => post(`/admin/users/${enc(uid)}/jobs/${enc(jobId)}/cancel`, { key, reason }),
  adminBlock: (uid, { key, blocked, reason }) => post(`/admin/users/${enc(uid)}/block`, { key, blocked, reason }),
  adminTopups: (q = {}) => request(`/admin/topups?${new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '' && v !== false))}`),
  adminRecheck: (uid, reference, { key, reason }) => post(`/admin/users/${enc(uid)}/topups/${enc(reference)}/recheck`, { key, reason }),
  adminJobs: (scope = 'active') => request(`/admin/jobs?${new URLSearchParams({ scope })}`),
  /** Modèles (vidéos à refaire) : liste complète (publiés ou non), un modèle, création, enregistrement, publication, ordre, suppression. */
  adminTemplates: () => request('/admin/templates'),
  adminTemplate: (id) => request(`/admin/templates/${enc(id)}`),
  adminCreateTemplate: (spec) => post('/admin/templates', spec),
  adminSaveTemplate: (id, spec) => request(`/admin/templates/${enc(id)}`, { method: 'PUT', body: JSON.stringify(spec) }),
  adminPublishTemplate: (id, published) => post(`/admin/templates/${enc(id)}/publish`, { published }),
  adminOrderTemplates: (ids) => post('/admin/templates/order', { ids }),
  adminDeleteTemplate: (id) => request(`/admin/templates/${enc(id)}`, { method: 'DELETE' }),
  /** Le modèle tel que Cinéma le reçoit (même forme que GET /templates), publié ou non : pour « Essayer sur mon compte ». */
  adminPreviewTemplate: (id) => request(`/admin/templates/${enc(id)}/preview`),
  /**
   * Dépose un fichier d'un modèle (vidéo d'exemple, source Genjutsu, fichier fixe d'une entrée), tel quel : il doit être déjà léger.
   * `role` : `video` | `source` | `input`. Rend { key, url, size, contentType, secs? } (secs : durée mesurée d'une source).
   */
  adminUploadTemplateFile: async (id, file, role) => {
    let res
    try {
      res = await fetch(`${BASE}/admin/templates/${enc(id)}/files?${new URLSearchParams({ role, name: file.name })}`, {
        method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream', ...(await authHeader()) },
      })
    } catch {
      throw new ApiError(0, { error: 'unreachable' })
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError(res.status, body)
    return body
  },
}

const enc = encodeURIComponent
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) })

async function sendFile(path, file) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': file.type, ...(await authHeader()) }, body: file })
  } catch {
    throw new ApiError(0, { error: 'unreachable' })
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body)
  return body
}
