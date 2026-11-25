/**
 * Textes légaux (/terms, /privacy) : du Markdown (src/content/legal) rendu en HTML au chargement de la page.
 * Les titres de section (h2) reçoivent un identifiant pour qu'on puisse y renvoyer (/privacy#8-vos-droits) ; le titre
 * « <h2 id="mentions-legales"> » écrit tel quel dans le texte garde le sien. Les blancs encore à remplir sont surlignés.
 */
import { Marked } from 'marked'

/** « 4. Le prix d'une création » → « 4-le-prix-d-une-creation » : minuscules, sans accents, tirets entre les mots. */
export const slug = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Surligne « [À COMPLÉTER : …] » (jaune, lg-todo) et « [À DÉCIDER : …] » (violet, lg-dec) dans le HTML rendu. */
export const highlightPlaceholders = (html) =>
  html
    .replace(/\[À COMPLÉTER[^\]]*\]/g, (m) => `<mark class="lg-todo">${m}</mark>`)
    .replace(/\[À DÉCIDER[^\]]*\]/g, (m) => `<mark class="lg-dec">${m}</mark>`)

/** Chaque tableau dans un bloc qui défile horizontalement sur petit écran, plutôt que d'élargir la page. */
export const wrapTables = (html) => html.replace(/<table>/g, '<div class="lg-tbl"><table>').replace(/<\/table>/g, '</table></div>')

const md = new Marked({
  renderer: {
    heading(text, level, raw) {
      if (level !== 2) return false
      return `<h2 id="${slug(raw)}">${text}</h2>\n`
    },
  },
})

/** Markdown → HTML de la page : sans le commentaire de tête, titres h2 ancrés, blancs surlignés, tableaux enveloppés. */
export function renderLegal(markdown) {
  const src = String(markdown ?? '').replace(/^\s*<!--[\s\S]*?-->\s*/, '')
  return wrapTables(highlightPlaceholders(md.parse(src)))
}

/**
 * Lien interne au site (« /privacy », « /terms#mentions-legales ») à ouvrir sans recharger la page, ou null : autre site,
 * nouvel onglet, téléchargement, ou clic avec une touche (Ctrl, ⌘, Maj, Alt) ou un autre bouton que le principal.
 */
export function internalHref(anchor, event, origin) {
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  if (anchor.target && anchor.target !== '_self') return null
  if (anchor.hasAttribute?.('download')) return null
  const href = anchor.getAttribute('href') ?? ''
  if (!href.startsWith('/') || href.startsWith('//')) return null
  try {
    const u = new URL(href, origin)
    return u.origin === new URL(origin).origin ? u.pathname + u.search + u.hash : null
  } catch {
    return null
  }
}
