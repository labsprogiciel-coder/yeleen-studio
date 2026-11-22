/**
 * Garde contre le double lancement d'une génération payante. Deux niveaux s'en servent : le bouton (lib/useLaunch.js), qui reste
 * occupé pendant tout l'envoi puis `LAUNCH_HOLD_MS`, et le moteur (lib/jobs.jsx), qui ignore une seconde demande identique tant que la
 * première est en cours d'envoi ou finie depuis moins de `LAUNCH_WINDOW_MS`. Pur : testable sans navigateur.
 */
export const LAUNCH_HOLD_MS = 1500
export const LAUNCH_WINDOW_MS = 1500

/** Le lancement a-t-il eu lieu ? Un gestionnaire rend `true`, ou le résultat de `submit` (`{ ok }`) ; tout le reste est un refus. */
export const launched = (r) => r === true || r?.ok === true

// Un fichier (File ou Blob) : il sait rendre son contenu. Un simple objet qui porte `name`, `size` et `type` n'en est pas un.
const isFile = (v) => typeof v.size === 'number' && typeof v.type === 'string' && typeof v.arrayBuffer === 'function'

// Forme stable d'une demande : clés triées, valeurs absentes ignorées, un fichier réduit à ce qui l'identifie (nom, taille, type).
// Sa date n'en fait pas partie : un fichier tiré de la bibliothèque est reconstruit à chaque lecture, avec la date du moment.
// Ce qui ne se décrit pas sûrement (fichier sans nom, Map, Set…) lève une erreur : la demande n'a alors pas de clé.
function canon(v, path = []) {
  if (v == null || typeof v !== 'object') return v
  if (isFile(v)) {
    if (typeof v.name !== 'string' || !v.name) throw new TypeError('fichier sans nom')
    return ['file', v.name, v.size, v.type]
  }
  if (v instanceof Date) return ['date', v.getTime()]
  if (Array.isArray(v)) return v.map((x) => canon(x, path))
  const proto = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) throw new TypeError('valeur sans forme stable')
  const out = {}
  for (const k of Object.keys(v).sort()) {
    if (v[k] === undefined) continue
    if (path.length === 1 && path[0] === 'recipe' && k === 'runId') continue // `spec.recipe.runId`, tiré au hasard à chaque clic : ce n'est pas ce qui distingue deux demandes
    out[k] = canon(v[k], [...path, k])
  }
  return out
}

/**
 * Identité d'une demande : deux demandes de même clé produiraient la même génération. `replaces` (nouvel essai d'une génération
 * donnée) en fait partie. `null` si la demande ne se laisse pas décrire (référence circulaire, fichier sans nom…) : elle n'est alors
 * jamais écartée.
 */
export function launchKey(spec, replaces = null) {
  try { return JSON.stringify([replaces ?? null, canon(spec)]) } catch { return null }
}

/**
 * Registre des lancements récents. `find(clé, maintenant)` rend le résultat du premier lancement s'il est encore en cours d'envoi
 * ou s'il date de moins de `windowMs` ; `record` l'inscrit (`pending` : l'envoi au service n'est pas fini), `settle` marque la fin
 * de l'envoi (la fenêtre repart de là), `drop` l'oublie (envoi échoué : on peut relancer tout de suite).
 */
export function createLaunchGuard(windowMs = LAUNCH_WINDOW_MS) {
  const seen = new Map()
  const fresh = (e, now) => e.pending || now - e.at < windowMs
  return {
    find(key, now) {
      const e = key == null ? null : seen.get(key)
      if (!e) return null
      if (fresh(e, now)) return e.result
      seen.delete(key)
      return null
    },
    record(key, result, now, pending = false) {
      if (key == null) return
      for (const [k, e] of seen) if (!fresh(e, now)) seen.delete(k)
      seen.set(key, { at: now, pending, result })
    },
    settle(key, result, now) {
      const e = seen.get(key)
      if (!e || e.result !== result) return
      e.pending = false
      if (now != null) e.at = now // la fenêtre repart de la fin de l'envoi : un appui juste après un envoi lent reste écarté
    },
    drop(key, result) {
      if (seen.get(key)?.result === result) seen.delete(key)
    },
    get size() { return seen.size },
  }
}
