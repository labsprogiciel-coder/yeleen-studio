import { Link } from 'react-router-dom'
import { RECIPES } from '@studio/catalog/recipes'
import { useAuthState } from '../lib/auth.jsx'
import { features } from '../lib/features.js'
import { CONTACT, SOCIALS } from '../lib/contact.js'
import { operatorsText, topupOperators } from '../lib/topups.js'
import { OPERATOR_LOGOS } from './OperatorLogos.jsx'
import '../styles/footer.css'

// Opérateurs des pays ouverts à la recharge (même règle que la fenêtre de recharge).
const OPS = topupOperators(import.meta.env.VITE_TOPUP_COUNTRIES)
const PAY = operatorsText(OPS)

// Les trois modèles mis en avant (les mêmes que la première image de l'accueil).
const TOP = ['wf-photo-to-video', 'wf-weather', 'wf-kling-multi-shot-creator'].map((id) => RECIPES.find((r) => r.id === id)).filter(Boolean)

/** Lien vers une section de l'accueil : ancre sur place depuis l'accueil, retour à l'accueil (sans recharger) ailleurs. */
function At({ home, id, ...rest }) {
  return home ? <a href={`#${id}`} {...rest} /> : <Link to={`/#${id}`} {...rest} />
}

/** Pied de page public (accueil, /terms, /privacy). `home` : les ancres de l'accueil restent sur place ; ailleurs, elles y ramènent. */
export default function SiteFooter({ home = false }) {
  const { signedIn } = useAuthState()
  const start = signedIn ? '/cinema' : '/sign-up'
  const hasContact = Boolean(CONTACT.email || CONTACT.whatsapp)
  return (
    <footer className="sf">
      <div className="sf-in">
        <div className="sf-brand">
          <b className="sf-name">Qreativ</b>
          <p>Des vidéos, des images et des voix par l’IA, pour les créateurs d’Afrique francophone.</p>
          {SOCIALS.length > 0 && (
            <ul className="sf-soc" aria-label="Réseaux sociaux">
              {SOCIALS.map((n) => (
                <li key={n.name}>
                  <a href={n.href} target="_blank" rel="noopener noreferrer" aria-label={`${n.name} (nouvel onglet)`}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d={n.path} /></svg>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="sf-pay">
            <span className="sf-ops" aria-hidden="true">
              {OPS.map((o) => <i key={o} className={`sf-op sf-op-${o}`}>{OPERATOR_LOGOS[o]}</i>)}
            </span>
            <span>Paiement par {PAY}</span>
          </div>
        </div>
        <nav className="sf-cols" aria-label="Pied de page">
          {/* Sans page d'accueil (drapeau `home` éteint), « / » mène au studio, donc à la connexion : pas de liens vers ses sections. */}
          {features.home && (
            <>
              <div>
                <h2>Modèles</h2>
                {TOP.map((r) => <Link key={r.id} to={start}>{r.name}</Link>)}
                <At home={home} id="modeles" className="sf-all">Tous les modèles →</At>
              </div>
              <div>
                <h2>Découvrir</h2>
                <At home={home} id="tarifs">Tarifs</At>
                <At home={home} id="faq">Questions fréquentes</At>
              </div>
            </>
          )}
          <div>
            <h2>Compte</h2>
            {signedIn
              ? <Link to="/cinema">Ouvrir le studio</Link>
              : <><Link to="/sign-up">Créer mon compte</Link><Link to="/sign-in">Connexion</Link></>}
          </div>
          <div>
            <h2>Légal</h2>
            <Link to="/terms">Conditions générales</Link>
            <Link to="/privacy">Confidentialité</Link>
            <Link to="/terms#mentions-legales">Mentions légales</Link>
          </div>
          {hasContact && (
            <div>
              <h2>Contact</h2>
              {CONTACT.email && <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>}
              {CONTACT.whatsapp && <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp Business<span className="sr-only"> (nouvel onglet)</span></a>}
            </div>
          )}
        </nav>
      </div>
      <div className="sf-bar">
        <small>© {new Date().getFullYear()} Qreativ · édité par PROGICIEL LABS, Ouagadougou, Burkina Faso</small>
        <small>Cauri : <a href="https://www.vecteezy.com" target="_blank" rel="noopener noreferrer">Vecteezy.com<span className="sr-only"> (nouvel onglet)</span></a></small>
      </div>
    </footer>
  )
}
