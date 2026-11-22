/**
 * Menu du compte de la barre latérale du studio Cinéma (components/cinema/AccountPopover.jsx) : nom affiché, initiales, lien d'aide
 * et position de la fenêtre. Rien ici ne touche au DOM : ces fonctions sont testées sous Node (test/accountMenu.test.js).
 */

/** Partie de l'adresse avant « @ » : « awa.traore@exemple.com » -> « awa.traore ». */
export function emailLocal(email) {
  const s = String(email ?? '').trim()
  const at = s.indexOf('@')
  return at > 0 ? s.slice(0, at) : s
}

/** Nom affiché : nom complet, sinon prénom et nom, sinon identifiant, sinon le début de l'adresse, sinon « Mon compte ». */
export function displayName({ fullName, firstName, lastName, username, email } = {}) {
  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
  return clean(fullName) || clean(`${firstName ?? ''} ${lastName ?? ''}`) || clean(username) || emailLocal(email) || 'Mon compte'
}

/** Deux initiales au plus, en capitales : « Awa Traoré » -> « AT », « awa.traore » -> « AT », « kofi » -> « K ». */
export function initials(name) {
  const words = String(name ?? '').split(/[\s._-]+/).filter((w) => /\p{L}|\p{N}/u.test(w))
  const firstChar = (w) => [...w.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? ''
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1)
  return picked.map(firstChar).join('').toLocaleUpperCase('fr') || '?'
}

/** Lien d'aide : WhatsApp en priorité (réponse plus rapide), sinon l'adresse de contact ; null sans contact configuré. */
export function helpLink({ whatsapp, email } = {}) {
  if (whatsapp) return { href: `https://wa.me/${whatsapp}`, external: true, via: 'WhatsApp' }
  if (email) return { href: `mailto:${email}`, external: false, via: 'e-mail' }
  return null
}

export const PHONE_MAX = 900 // en dessous (ou à égalité), une seule colonne : la barre latérale s'ouvre en volet
export const GUTTER = 16 // marge minimale entre la fenêtre et le bord de l'écran sur téléphone
const EDGE = 8 // marge minimale sur grand écran
const GAP = 8 // écart entre la fenêtre et la barre (ou le bouton)

/**
 * Position (`position: fixed`) de la fenêtre du compte.
 * - Grand écran : à droite de la barre latérale (`railRight`), le bas aligné sur celui du bouton, sans jamais sortir de l'écran.
 * - Téléphone (largeur <= 900 px) : sous le bouton, alignée sur son bord droit, dans des marges de 16 px ; au-dessus de lui quand la
 *   place manque dessous et qu'il y en a davantage dessus (le bouton est en bas du volet).
 *   Dans le volet, `within` (bords gauche et droit de ses entrées) borne aussi sa largeur : elle ne dépasse pas sur le fond assombri.
 * La hauteur est bornée (`maxHeight`) : au-delà, la fenêtre défile.
 *
 * @param {{ trigger: {left:number,top:number,right:number,bottom:number}, railRight?: number, menu: {width:number,height:number},
 *           viewport: {width:number,height:number}, within?: {left:number,right:number} }} p
 * @returns {{ left:number, top:number, width:number, maxHeight:number, side:'right'|'below'|'above' }}
 */
export function placeAccountMenu({ trigger, railRight, menu, viewport, within }) {
  const vw = Math.max(0, viewport.width)
  const vh = Math.max(0, viewport.height)
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi))
  if (vw <= PHONE_MAX) {
    const lo = within ? Math.max(0, within.left) : GUTTER
    const hi = within ? Math.min(vw, within.right) : vw - GUTTER
    const width = Math.max(0, Math.min(menu.width, hi - lo))
    const left = clamp(trigger.right - width, lo, hi - width)
    const top = Math.max(GUTTER, trigger.bottom + GAP)
    const maxHeight = Math.max(0, vh - top - GUTTER)
    const above = Math.max(0, trigger.top - GAP - GUTTER) // hauteur libre au-dessus du bouton
    if (menu.height > maxHeight && above > maxHeight) {
      return { left, top: trigger.top - GAP - Math.min(menu.height, above), width, maxHeight: above, side: 'above' }
    }
    return { left, top, width, maxHeight, side: 'below' }
  }
  const width = Math.max(0, Math.min(menu.width, vw - 2 * EDGE))
  const maxHeight = Math.max(0, vh - 2 * EDGE)
  const height = Math.min(menu.height, maxHeight)
  const left = clamp((railRight ?? trigger.right) + GAP, EDGE, vw - EDGE - width)
  const top = clamp(trigger.bottom - height, EDGE, vh - EDGE - height)
  return { left, top, width, maxHeight, side: 'right' }
}
