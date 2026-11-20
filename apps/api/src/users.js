/**
 * Utilisateurs dans D1 : une ligne par compte Clerk, créée à la première requête authentifiée.
 * D1 ne tient que le profil (pour l'analyse et les rapports) ; le portefeuille et les générations restent dans le Durable Object du compte,
 * seul écrivain de l'argent. Un échec de D1 ne doit jamais bloquer une requête : l'appelant journalise et continue.
 */
const TOUCH_MS = 10 * 60_000 // « dernière activité » : au plus une écriture par utilisateur et par 10 minutes
const MAX_SEEN = 5000

// Dans cette instance du Worker : utilisateur → dernier passage par D1. Évite d'interroger la base à chaque requête.
const seen = new Map()

export const resetUserCache = () => seen.clear()

/**
 * Garantit la ligne de l'utilisateur et retourne { created, welcomedAt }. Sans effet (et sans appel à D1) si on l'a vu il y a moins de 10 minutes.
 * `profile` : { email, name, country, avatarUrl } quand on les connaît (un NULL n'efface jamais une valeur connue).
 * La photo (`avatarUrl`, déjà validée par l'appelant, voir avatarUrl) va dans `user_avatars`, réécrite seulement si elle a changé.
 */
export async function ensureUser(db, id, profile = {}, now = Date.now()) {
  const last = seen.get(id)
  if (last && now - last.at < TOUCH_MS) return { created: false, welcomedAt: last.welcomedAt, cached: true }

  const { email = null, name = null, country = null, avatarUrl: avatar = null } = profile
  const ins = await db.prepare('INSERT INTO users (id, created_at, last_seen_at, email, name, country) VALUES (?1, ?2, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO NOTHING')
    .bind(id, now, email, name, country).run()
  const created = (ins.meta?.changes ?? 0) > 0
  if (!created) {
    await db.prepare('UPDATE users SET last_seen_at = ?2, email = COALESCE(?3, email), name = COALESCE(?4, name) WHERE id = ?1')
      .bind(id, now, email, name).run()
  }
  if (avatar) {
    await db.prepare('INSERT INTO user_avatars (user_id, url, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at WHERE user_avatars.url <> excluded.url')
      .bind(id, avatar, now).run()
  }
  const row = await db.prepare('SELECT welcomed_at FROM users WHERE id = ?1').bind(id).first()
  if (seen.size >= MAX_SEEN) seen.clear()
  seen.set(id, { at: now, welcomedAt: row?.welcomed_at ?? null })
  return { created, welcomedAt: row?.welcomed_at ?? null }
}

/** Note que le crédit de bienvenue a été accordé (une seule fois : sans effet s'il l'est déjà). */
export async function markWelcomed(db, id, now = Date.now()) {
  const r = await db.prepare('UPDATE users SET welcomed_at = ?2 WHERE id = ?1 AND welcomed_at IS NULL').bind(id, now).run()
  const entry = seen.get(id)
  if (entry) entry.welcomedAt = now
  return (r.meta?.changes ?? 0) > 0
}

export const getUser = (db, id) =>
  db.prepare('SELECT u.id, u.created_at AS createdAt, u.last_seen_at AS lastSeenAt, u.email, u.name, u.country, u.welcomed_at AS welcomedAt, a.url AS avatarUrl FROM users u LEFT JOIN user_avatars a ON a.user_id = u.id WHERE u.id = ?1').bind(id).first()

const MAX_AVATAR = 500
/**
 * Adresse de la photo de profil lue dans le jeton (`picture`, sinon `image_url`) : https seulement, 500 caractères au plus, sans
 * identifiants ni espaces ; sinon null (rien n'est écrit, la photo connue reste).
 */
export function avatarUrl(claims = {}) {
  const v = claims.picture ?? claims.image_url
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_AVATAR || /[\s\u0000-\u001f\u007f]/.test(v)) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname ? v : null
  } catch { return null }
}
