import { useNavigate } from 'react-router-dom'
import useDocumentTitle from '../lib/useDocumentTitle.js'
import useHashScroll from '../lib/useHashScroll.js'
import { HomeHeader, SkipLink } from '../components/Headers.jsx'
import SiteFooter from '../components/SiteFooter.jsx'
import { internalHref, renderLegal } from '../lib/legal.js'
import terms from '../content/legal/terms.md?raw'
import privacy from '../content/legal/privacy.md?raw'
import '../styles/home.css'
import '../styles/legal.css'

// Pages publiques, sans connexion. Le texte vit dans src/content/legal ; marked n'est chargé qu'avec cette page (React.lazy).
const PAGES = {
  terms: { title: 'Conditions générales', html: renderLegal(terms) },
  privacy: { title: 'Confidentialité', html: renderLegal(privacy) },
}

/** /terms (conditions générales puis mentions légales) ou /privacy : l'en-tête et le pied de page de l'accueil autour du texte. */
export default function Legal({ page }) {
  const p = PAGES[page]
  useDocumentTitle(p.title)
  const navigate = useNavigate()
  useHashScroll() // arrivée sur une section (/terms#mentions-legales) : on y descend une fois le texte affiché
  // Les liens du texte vers /terms ou /privacy restent dans l'application, sans recharger la page.
  const onClick = (e) => {
    const to = internalHref(e.target.closest?.('a'), e, window.location.origin)
    if (to) { e.preventDefault(); navigate(to) }
  }
  return (
    <div className="pg home legal">
      <SkipLink />
      <HomeHeader />
      <main id="main" tabIndex={-1}>
        <div className="wrap lgp">
          {/* Le texte vient de nos propres fichiers Markdown, compilés avec l'application : pas de contenu d'utilisateur. */}
          <article className="lg-doc" onClick={onClick} dangerouslySetInnerHTML={{ __html: p.html }} />
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
