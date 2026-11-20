import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api, apiEnabled } from './api.js'
import { useAuthState } from './auth.jsx'

/**
 * Le compte connecté est-il administrateur ? On le demande à l'API (`GET /admin/me` : 200 ou 403), une fois par session de page :
 * jamais d'après une donnée du navigateur (rôle Clerk, localStorage). Un changement de compte recharge la page (lib/auth.jsx),
 * ce qui vide ce cache. Une autre erreur (réseau, session, API ou base indisponible) n'est pas retenue ni prise pour un refus :
 * `error` est vrai et l'on redemandera (bouton « Réessayer », ou au prochain montage).
 */
let cached = null // Promise<{ admin, error }> | null

function ask() {
  if (!cached) {
    // Après les effets du rendu courant : `Bridge` (lib/auth.jsx) installe le jeton de session dans son propre effet, qui passe après ceux des enfants.
    cached = Promise.resolve().then(() => api.adminMe()).then((r) => ({ admin: r?.admin === true, error: false }), (e) => {
      if (e?.status === 403) return { admin: false, error: false }
      cached = null
      return { admin: false, error: true }
    })
  }
  return cached
}

/**
 * { ready, admin, error, retry } : `ready` faux tant que l'API n'a pas répondu ; `error` : la question n'a pas abouti (ce n'est pas
 * un refus). Sans API ou sans session, personne n'est administrateur.
 */
export default function useIsAdmin() {
  const { ready, signedIn } = useAuthState()
  const can = apiEnabled && ready && signedIn
  const [state, setState] = useState({ ready: !can, admin: false, error: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!can) { setState({ ready: ready || !apiEnabled, admin: false, error: false }); return undefined }
    let alive = true
    ask().then(({ admin, error }) => { if (alive) setState({ ready: true, admin, error }) })
    return () => { alive = false }
  }, [can, ready, attempt])
  const retry = useCallback(() => { setState((s) => ({ ...s, ready: false })); setAttempt((n) => n + 1) }, [])
  return { ...state, retry }
}

/**
 * Réserve un écran aux administrateurs confirmés par l'API ; un refus confirmé (403) renvoie vers le studio Cinéma. Si la question
 * n'a pas abouti (réseau, API indisponible), on le dit et l'on propose de réessayer, sans renvoyer ailleurs.
 */
export function AdminOnly({ children }) {
  const { ready, admin, error, retry } = useIsAdmin()
  if (!ready) return <div className="route-fallback" />
  if (admin) return children
  if (error) {
    return (
      <div className="route-fallback admin-check" role="alert">
        <p>Impossible de vérifier vos droits d’administration : le studio ne répond pas. Vérifiez votre connexion, puis réessayez.</p>
        <button type="button" onClick={retry}>Réessayer</button>
      </div>
    )
  }
  return <Navigate to="/cinema" replace />
}
