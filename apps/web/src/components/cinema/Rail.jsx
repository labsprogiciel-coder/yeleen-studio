import { Link } from 'react-router-dom'
import Icon from '../../lib/icons.jsx'
import { features } from '../../lib/features.js'
import { useJobs } from '../../lib/jobs.jsx'
import { useLibrary } from '../../lib/libraryDialog.jsx'
import { useRecharge } from '../../lib/rechargeDialog.jsx'
import { useTheme } from '../../lib/theme.jsx'
import Cauri from '../Cauri.jsx'
import { BalanceNumber, useBalance } from '../BalanceValue.jsx'
import AccountPopover from './AccountPopover.jsx'
import markPlain from '../../assets/brand/qreativ-mark.svg'
import markReversed from '../../assets/brand/qreativ-mark-reversed.svg'
import lockupPlain from '../../assets/brand/qreativ-lockup-horizontal-primary.svg'
import lockupReversed from '../../assets/brand/qreativ-lockup-horizontal-reversed.svg'

const TABS = [
  { id: 'image', icon: 'img', label: 'Image' },
  { id: 'video', icon: 'vid', label: 'Vidéo' },
  { id: 'audio', icon: 'mic', label: 'Audio' },
  { id: 'recipe', icon: 'layers', label: 'Modèles' },
]
// Chaque entrée ouvre la fenêtre de la bibliothèque sur la bonne vue.
const FILES = [
  { view: { tab: 'library', sub: 'all', origin: 'generated' }, icon: 'sparkle', label: 'Mes générations' },
  { view: { tab: 'library', sub: 'all', origin: 'upload' }, icon: 'at', label: 'Mes éléments' },
  { view: { tab: 'favs' }, icon: 'star', label: 'Mes favoris' },
]

/**
 * Solde de cauris (et générations en cours) : ouvre la recharge. Compact quand la barre est réduite, et dans la barre du projet
 * sur téléphone. `onPick` : appelé avant d'ouvrir la recharge (le volet du téléphone se ferme).
 */
export function RailBalance({ onPick }) {
  const { running, queued } = useJobs()
  const view = useBalance()
  const { openRecharge } = useRecharge()
  const busy = running + queued
  // Solde illisible : le bouton le relit au lieu d'ouvrir la recharge.
  const label = view.failed ? 'Solde indisponible. Réessayer' : `Solde : ${view.spoken}${busy ? `, ${busy} génération${busy > 1 ? 's' : ''} en cours` : ''}. Recharger`
  return (
    <button type="button" className={`cx-bal${view.failed ? ' is-failed' : ''}`} aria-haspopup={view.failed ? undefined : 'dialog'} aria-label={label} title={label} onClick={() => { if (view.failed) return view.reload(); onPick?.(); openRecharge() }}>
      <span className="cx-bal-ic"><Cauri size={18} />{busy > 0 && <i className="cx-bal-dot" aria-hidden="true" />}</span>
      <b><BalanceNumber view={view} /></b>
      <span className="cx-lbl">{view.failed ? 'Réessayer' : `cauris${busy > 0 ? ` · ${busy} en cours` : ''}`}</span>
    </button>
  )
}

/**
 * Barre latérale du studio : la seule barre de l'écran. En haut le logo et « Nouvelle création », au milieu les types de création et
 * les fichiers, en bas le solde et le compte (AccountPopover : solde, gestion du compte, administration, thème, aide, déconnexion).
 * `collapsed` vient de Cinéma (le bouton de repli est dans la barre du projet). Réduite, elle ne montre
 * que les icônes (libellés en infobulle) ; agrandie, l'icône et le libellé. Sur téléphone, elle s'ouvre en volet (RailDrawer.jsx) :
 * `onClose` ferme ce volet ; il est appelé par le bouton × de l'en-tête et avant chaque choix.
 */
export default function Rail({ tab, onTab, onNew, collapsed, onClose }) {
  const drawer = Boolean(onClose)
  const pick = (fn) => () => { onClose?.(); fn() }
  const { openLibrary } = useLibrary()
  const { isDark } = useTheme()
  // Réduite, un libellé seul (title) aide la souris ; agrandie, il est déjà écrit : pas d'infobulle en double.
  const tip = (label) => (collapsed ? label : undefined)
  const item = (key, label, iconName, props) => (
    <li key={key}>
      <button type="button" className="cx-ri" aria-label={label} title={tip(label)} {...props}>
        <Icon name={iconName} size={20} /><span className="cx-lbl" aria-hidden="true">{label}</span>
      </button>
    </li>
  )
  return (
    <nav className={`cx-rail${drawer ? ' is-drawer' : collapsed ? ' is-collapsed' : ''}`} aria-label="Espace de travail">
      <div className="cx-rh">
        <Link to={features.home ? '/' : '/cinema'} className="cx-logo" aria-label="Qreativ, accueil" onClick={onClose}>
          {/* Fond de la barre : blanc en thème clair (logo Plum), Plum foncé en thème sombre (logo inversé). */}
          <img className="cx-logo-mark" src={isDark ? markReversed : markPlain} alt="" width="32" height="32" />
          <img className="cx-logo-full" src={isDark ? lockupReversed : lockupPlain} alt="" height="26" />
        </Link>
        {drawer && <button type="button" className="cx-fold cx-rail-x" aria-label="Fermer le menu" onClick={onClose}><Icon name="close" size={20} /></button>}
      </div>
      <button type="button" className="cx-new" aria-label="Nouvelle création" title={tip('Nouvelle création')} onClick={pick(onNew)}>
        <Icon name="plus" size={17} /><span className="cx-lbl" aria-hidden="true">Nouvelle création</span>
      </button>
      <div className="cx-rs">
        <ul className="cx-rl" aria-label="Type de création">
          {TABS.map((t) => item(t.id, t.label, t.icon, { 'aria-current': tab === t.id ? 'true' : undefined, onClick: pick(() => onTab(t.id)) }))}
        </ul>
        <i className="cx-sep" aria-hidden="true" />
        <ul className="cx-rl" aria-label="Mes fichiers">
          {FILES.map((f) => item(f.label, f.label, f.icon, { 'aria-haspopup': 'dialog', onClick: pick(() => openLibrary(f.view)) }))}
          {item('lib', 'Bibliothèque', 'folder', { 'aria-haspopup': 'dialog', onClick: pick(() => openLibrary()) })}
        </ul>
      </div>
      <div className="cx-rf">
        <RailBalance onPick={onClose} />
        <AccountPopover collapsed={collapsed} onPick={onClose} />
      </div>
    </nav>
  )
}
