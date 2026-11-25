import { useEffect, useRef } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import Icon from '../lib/icons.jsx'
import BalanceChip from './BalanceChip.jsx'
import Cauri from './Cauri.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { AccountMenu, authEnabled, useAuthState } from '../lib/auth.jsx'
import { features } from '../lib/features.js'
import { useLibrary } from '../lib/libraryDialog.jsx'
import useIsAdmin from '../lib/useIsAdmin.jsx'
import { RechargeButton } from '../lib/rechargeDialog.jsx'
import lockup from '../assets/brand/qreativ-lockup-horizontal-reversed.svg'
import mark from '../assets/brand/qreativ-mark-reversed.svg'
import '../styles/chrome.css'

const ROUTES = { Explorer: '/', Image: '/image', Vidéo: '/video', Audio: '/audio', 'Spot pub': '/spot', Marque: '/brand', Cinéma: '/cinema', Admin: '/admin' } // Bibliothèque : une fenêtre, pas une page

// Seules les pages qui existent figurent dans la navigation.
const FLAG_OF = { Explorer: 'home', Image: 'image', Vidéo: 'video', Audio: 'audio', 'Spot pub': 'spot', Marque: 'brand' } // écrans éteints par drapeau : absents de la navigation
export const NAV = ['Explorer', 'Image', 'Vidéo', 'Cinéma', 'Audio', 'Spot pub', 'Marque', 'Bibliothèque'].filter((l) => !FLAG_OF[l] || features[FLAG_OF[l]])

export function Logo() {
  return (
    <NavLink to="/" className="lg" aria-label="Qreativ, accueil">
      {/* Logo horizontal inversé (la barre est Plum dans les deux thèmes) ; sur écran étroit, la marque seule. */}
      <picture>
        <source media="(max-width: 560px)" srcSet={mark} />
        <img src={lockup} alt="" height="24" />
      </picture>
    </NavLink>
  )
}

function NavLinks() {
  const nav = useRef(null)
  const { pathname } = useLocation()
  const { openLibrary } = useLibrary()
  const { admin } = useIsAdmin() // lien « Admin » seulement pour un compte confirmé par l'API ; la page reste gardée de son côté
  const links = admin ? [...NAV, 'Admin'] : NAV
  // Sur écran étroit la barre défile : on amène le lien de la page courante dans la zone visible.
  useEffect(() => {
    const el = nav.current?.querySelector('.nl.on')
    if (nav.current && el) nav.current.scrollTo({ left: el.offsetLeft - (nav.current.clientWidth - el.offsetWidth) / 2 })
  }, [pathname])
  return (
    <nav className="nls" ref={nav} aria-label="Navigation principale">
      {links.map((label) => (label === 'Bibliothèque'
        ? <button key={label} type="button" className="nl" aria-haspopup="dialog" onClick={() => openLibrary()}>{label}</button>
        : (
          <NavLink key={label} to={ROUTES[label]} end={label === 'Explorer'} className={({ isActive }) => `nl${isActive ? ' on' : ''}`}>
            {label}
          </NavLink>
        )))}
    </nav>
  )
}

/**
 * En-tête compact des écrans d'outils (Cinéma, vidéo, image, audio, spot) : la même barre Plum partout.
 * `minimal` (écran d'administration) : réduite au logo, à la navigation et au compte.
 */
export function ShellHeader({ minimal = false }) {
  return (
    <header className="nv">
      <Logo />
      <NavLinks />
      <div className="rt">
        {!minimal && (
          <>
            <BalanceChip />
            <Icon name="search" />
            <ThemeToggle className="pb nv-theme" size={16} />
            <RechargeButton className="pb">Recharger</RechargeButton>
            <a href="#" className="pb">Entreprise</a>
            <a href="#" className="pb">Ressources</a>
          </>
        )}
        <AccountMenu fallback={<span className="av" />} />
      </div>
    </header>
  )
}

/** Connexion et création de compte (Clerk), ou le menu du compte une fois connecté. Sans Clerk (développement), les emplacements d'origine. */
function HomeAccount() {
  const { signedIn } = useAuthState()
  if (!authEnabled) return (<><a href="#" className="pb si">Connexion</a><a href="#" className="lim">Créer un compte</a></>)
  if (signedIn) return <AccountMenu />
  return (<><NavLink to="/sign-in" className="pb si">Connexion</NavLink><NavLink to="/sign-up" className="lim">Créer un compte</NavLink></>)
}

/** En-tête de la page d'accueil. La navigation (Explorer, Cinéma, Bibliothèque) mène à des écrans réservés : elle n'est montrée qu'une fois connecté. */
/** En-tête public. `home` : posé par l'accueil, « Tarifs » reste sur place ; ailleurs (/terms, /privacy), il y ramène, à la bonne section. */
export function HomeHeader({ home = false }) {
  const { signedIn } = useAuthState()
  return (
    <header className="nv">
      <Logo />
      {signedIn && <NavLinks />}
      <div className="rt">
        {/* Sans page d'accueil (drapeau `home` éteint), « / » mène au studio : pas de lien « Tarifs ». */}
        {home ? <a href="#tarifs" className="pb"><Cauri size={16} />Tarifs</a> : features.home && <Link to="/#tarifs" className="pb"><Cauri size={16} />Tarifs</Link>}
        <HomeAccount />
      </div>
    </header>
  )
}

/** Lien d'évitement : premier élément focalisable, mène au contenu principal (`id="main"`, ou `to` quand un autre panneau est seul à l'écran). */
export function SkipLink({ to = 'main' }) {
  return <a className="skip" href={`#${to}`}>Aller au contenu</a>
}
