import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ClerkProvider, SignIn, SignUp, UserButton, useAuth } from '@clerk/clerk-react'
import { setTokenGetter } from './api.js'
import { setSentryUser } from './sentry.js'
import { setAnalyticsUser } from './posthog.js'
import stacked from '../assets/brand/qreativ-lockup-stacked-primary.svg'

/**
 * Connexion avec Clerk. Sans `VITE_CLERK_PUBLISHABLE_KEY` (développement local), il n'y a pas de garde : l'API locale
 * (ENV=dev sans CLERK_ISSUER) sert alors un compte de démonstration unique. Avec la clé, les écrans de création exigent une
 * session, et chaque appel à l'API porte le jeton de session (l'API vérifie la signature : la garde réelle est côté serveur).
 */
const KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
export const authEnabled = Boolean(KEY)

const Ctx = createContext({ enabled: false, ready: true, signedIn: true })
/** { enabled, ready, signedIn } : sans Clerk, tout le monde est « connecté » (compte de démonstration). */
export const useAuthState = () => useContext(Ctx)

// Charte Qreativ : cartes Paper sur fond Fog, texte Plum, bouton Tangerine (texte Plum), liens Cobalt.
const appearance = {
  variables: {
    colorPrimary: '#FF5A1F', colorTextOnPrimaryBackground: '#3A1456', colorBackground: '#FFFFFF', colorText: '#3A1456', colorTextSecondary: '#4A5068',
    colorInputBackground: '#FFFFFF', colorInputText: '#3A1456', colorNeutral: '#3A1456', colorDanger: '#C4321A', borderRadius: '14px',
    fontFamily: "'Hanken Grotesk', Helvetica, sans-serif",
  },
  elements: {
    card: { boxShadow: '0 10px 28px rgba(58, 20, 86, 0.10)', border: '1px solid #E3E7EF' },
    headerTitle: { fontFamily: "'Bricolage Grotesque', 'Hanken Grotesk', sans-serif", fontWeight: 800 },
    footerActionLink: { color: '#2B3BFF' },
    formButtonPrimary: { fontWeight: 700 },
  },
}

/**
 * Bibliothèque, marque et fichiers importés vivent dans le navigateur : sur un ordinateur partagé, le suivant ne doit pas les voir.
 * À la déconnexion, ou quand le compte change, on efface ces données locales puis on recharge.
 */
function wipeLocal() {
  try { Object.keys(localStorage).filter((k) => k.startsWith('studio.') && !k.startsWith('studio.cinema.promo')).forEach((k) => localStorage.removeItem(k)) } catch { /* ignoré */ }
  try { indexedDB.deleteDatabase('studio-assets') } catch { /* ignoré */ }
}

/** Donne à l'API le moyen d'obtenir un jeton frais, et publie l'état de la connexion. */
function Bridge({ children }) {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth()
  const last = useRef(undefined) // dernier compte vu : undefined tant que Clerk n'a pas répondu
  useEffect(() => {
    if (!isLoaded) return
    if (last.current && last.current !== userId) { wipeLocal(); location.replace('/'); return }
    last.current = userId ?? null
    setSentryUser(userId)
    setAnalyticsUser(userId)
  }, [isLoaded, userId])
  useEffect(() => {
    setTokenGetter(isSignedIn ? () => getToken() : null)
    return () => setTokenGetter(null)
  }, [isSignedIn, getToken])
  const value = useMemo(() => ({ enabled: true, ready: isLoaded, signedIn: Boolean(isSignedIn) }), [isLoaded, isSignedIn])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Les textes français de Clerk pèsent 55 ko (minifiés) : on les charge à part, juste après le premier rendu, au lieu de les mettre dans le paquet
 * d'entrée que tout visiteur télécharge. Clerk applique une langue qui change après coup (`localization` est réactif) : le temps du chargement,
 * ses fenêtres sont en anglais, et personne ne les voit si vite (elles attendent que Clerk lui-même arrive de son CDN). Le chemin `/fr-FR`
 * n'embarque que le français : importer le paquet entier ajouterait les 300 langues.
 */
function useFrench() {
  const [loc, setLoc] = useState(null)
  useEffect(() => {
    if (!authEnabled) return undefined
    let alive = true
    import('@clerk/localizations/fr-FR').then((m) => { if (alive) setLoc(m.frFR) }).catch(() => { /* l'anglais de Clerk reste */ })
    return () => { alive = false }
  }, [])
  return loc
}

export function AuthProvider({ children }) {
  const navigate = useNavigate()
  const localization = useFrench()
  if (!authEnabled) return children
  return (
    <ClerkProvider
      publishableKey={KEY}
      localization={localization ?? undefined}
      appearance={appearance}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/sign-in"
      signInFallbackRedirectUrl="/cinema"
      signUpFallbackRedirectUrl="/cinema"
    >
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  )
}

/** Réserve un écran aux utilisateurs connectés ; sinon, page de connexion puis retour ici. */
export function Protected({ children }) {
  const { enabled, ready, signedIn } = useAuthState()
  const { pathname, search } = useLocation()
  if (!enabled || signedIn) return children
  if (!ready) return <div className="route-fallback" />
  return <Navigate to={`/sign-in?redirect_url=${encodeURIComponent(pathname + search)}`} replace />
}

/**
 * Pages de connexion et d'inscription : la porte d'entrée tant que la page d'accueil est éteinte (drapeau `home`). Fond Fog,
 * logo Qreativ empilé, phrase de la marque, puis le formulaire Clerk. Après connexion : le studio (ou la page demandée).
 */
function AuthGate({ children }) {
  return (
    <main className="auth-gate">
      <img className="auth-logo" src={stacked} alt="Qreativ" width="180" height="153" />
      <p className="auth-tag">Vos idées, en mouvement.</p>
      {children}
    </main>
  )
}
export const SignInPage = () => (authEnabled ? <AuthGate><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" /></AuthGate> : <Navigate to="/cinema" replace />)
export const SignUpPage = () => (authEnabled ? <AuthGate><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" /></AuthGate> : <Navigate to="/cinema" replace />)

/** Menu du compte (déconnexion…), ou l'avatar de démonstration sans Clerk. */
export function AccountMenu({ fallback = null }) {
  const { enabled, signedIn } = useAuthState()
  return enabled && signedIn ? <UserButton afterSignOutUrl="/sign-in" appearance={{ elements: { avatarBox: { width: 28, height: 28 } } }} /> : fallback
}
