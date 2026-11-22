import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import Icon from '../../lib/icons.jsx'
import { useAccount } from '../../lib/auth.jsx'
import { helpLink, initials, placeAccountMenu } from '../../lib/accountMenu.js'
import { CONTACT } from '../../lib/contact.js'

import { useRecharge } from '../../lib/rechargeDialog.jsx'
import { useTheme } from '../../lib/theme.jsx'
import useIsAdmin from '../../lib/useIsAdmin.jsx'
import Cauri from '../Cauri.jsx'
import { BalanceNumber, useBalance } from '../BalanceValue.jsx'

const HELP = helpLink(CONTACT)

/** Photo du compte, ou ses initiales ; le compte de démonstration garde son disque dégradé. */
function Avatar({ account, size }) {
  if (account.imageUrl) return <img className="cx-av" src={account.imageUrl} alt="" width={size} height={size} />
  if (account.demo) return <i className="cx-av cx-av-demo" style={{ width: size, height: size }} aria-hidden="true" />
  return <span className="cx-av cx-av-ini" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{initials(account.name)}</span>
}

/**
 * Compte, en bas de la barre latérale du studio Cinéma : l'avatar (et le nom quand la barre est agrandie) ouvre une fenêtre avec le
 * compte, le solde et « Recharger », puis gérer le compte, l'administration, le thème, l'aide et la déconnexion. La fenêtre s'ouvre à
 * droite de la barre (au-dessus du bouton dans le volet du téléphone) et reste dans l'écran (placeAccountMenu). Clavier : flèches,
 * Début/Fin, Échap. `onPick` : appelé à chaque choix (le volet du téléphone se ferme).
 */
export default function AccountPopover({ collapsed, onPick }) {
  const account = useAccount()
  const bal = useBalance()
  const { openRecharge } = useRecharge()
  const { isDark, toggleTheme } = useTheme()
  const { admin } = useIsAdmin()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const pop = useRef(null)

  const close = useCallback((refocus = false) => {
    setOpen(false)
    setPos(null)
    if (refocus) btn.current?.focus()
  }, [])

  const place = useCallback(() => {
    if (!btn.current || !pop.current) return
    const rail = btn.current.closest('.cx-rail')
    const trigger = btn.current.getBoundingClientRect()
    const p = placeAccountMenu({
      trigger,
      within: btn.current.closest('dialog') ? trigger : undefined, // volet du téléphone : pas plus large que ses entrées
      railRight: rail?.getBoundingClientRect().right,
      menu: { width: 300, height: pop.current.scrollHeight },
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
    })
    setPos(p)
  }, [])

  // Mesure puis place avant l'affichage : pas de saut visible.
  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) close() }
    // La page qui défile (téléphone) laisserait la fenêtre fixe loin de son bouton : on la ferme.
    const onScroll = (e) => { if (!(e.target instanceof Node) || !pop.current?.contains(e.target)) close() }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, close, place])

  // Une fois placée (visible), le focus va au premier choix.
  const placed = pos !== null
  useEffect(() => {
    if (placed && !pop.current?.contains(document.activeElement)) pop.current?.querySelector('[role="menuitem"]')?.focus()
  }, [placed])

  const onKey = (e) => {
    const items = [...pop.current.querySelectorAll('[role="menuitem"]')]
    const i = items.indexOf(document.activeElement)
    const go = (n) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus() }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i < 0 ? items.length - 1 : i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape') { e.preventDefault(); close(true) }
    // Tab ferme et rend le focus au bouton avant le Tab natif : la tabulation reprend juste après (ou avant) l'avatar.
    else if (e.key === 'Tab') close(true)
  }

  // Chaque choix ferme la fenêtre (le focus revient au bouton), puis agit.
  const pick = (fn) => () => { close(true); onPick?.(); fn?.() }

  const label = account.demo ? 'Compte de démonstration' : `Compte : ${account.name}`
  const item = (key, iconName, text, props, Tag = 'button') => (
    <Tag key={key} role="menuitem" tabIndex={-1} className="cx-am-it" {...(Tag === 'button' ? { type: 'button' } : {})} {...props}>
      <Icon name={iconName} size={19} /><span>{text}</span>
    </Tag>
  )

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`cx-acct${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}. Menu du compte`}
        title={collapsed ? label : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Avatar account={account} size={28} />
        <span className="cx-lbl" aria-hidden="true">{account.name}</span>
      </button>
      {open && createPortal(
        <div
          ref={pop}
          className={`cx-am${pos ? ` is-${pos.side}` : ''}`}
          role="menu"
          aria-label={account.email ? `${label} (${account.email})` : label}
          style={pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight } : { left: 0, top: 0, width: 300, visibility: 'hidden' }}
          onKeyDown={onKey}
        >
          <div className="cx-am-head" aria-hidden="true">
            <Avatar account={account} size={44} />
            <span className="cx-am-who">
              <b>{account.name}</b>
              {account.email && <small>{account.email}</small>}
            </span>
          </div>
          <div className="cx-am-bal" role="group" aria-label={`Solde : ${bal.spoken}`}>
            <span className="cx-am-bal-tx" aria-hidden="true">
              <small>Solde</small>
              <span className="cx-am-bal-n"><Cauri size={18} /><b><BalanceNumber view={bal} /></b> cauris</span>
            </span>
            <button type="button" role="menuitem" tabIndex={-1} className="cx-am-top" aria-haspopup="dialog" onClick={pick(() => openRecharge())}>Recharger</button>
          </div>
          <div className="cx-am-list">
            {account.manage && item('manage', 'user', 'Gérer mon compte', { onClick: pick(account.manage) })}
            {admin && item('admin', 'gauge', 'Administration', { to: '/admin', onClick: () => { close(); onPick?.() } }, Link)}
            {item('theme', isDark ? 'sun' : 'moon', isDark ? 'Mode clair' : 'Mode sombre', { onClick: pick(toggleTheme) })}
            {HELP && item('help', 'help', 'Aide', {
              href: HELP.href,
              onClick: () => { close(); onPick?.() },
              title: `Écrire au support (${HELP.via})`,
              ...(HELP.external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
            }, 'a')}
          </div>
          {account.signOut && (
            <>
              <i className="cx-am-sep" role="separator" />
              <div className="cx-am-list">{item('out', 'logout', 'Se déconnecter', { onClick: pick(account.signOut) })}</div>
            </>
          )}
        </div>,
        btn.current?.closest('dialog') ?? document.body, // dans le volet du téléphone (fenêtre modale), elle reste avec lui au premier plan
      )}
    </>
  )
}
