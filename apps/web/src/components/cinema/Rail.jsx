import { Link } from 'react-router-dom'
import Icon from '../../lib/icons.jsx'
import icon from '../../assets/brand/yeelen-icon.svg'
import { features } from '../../lib/features.js'
import { useLibrary } from '../../lib/libraryDialog.jsx'
import { useRecharge } from '../../lib/rechargeDialog.jsx'

const TABS = [
  { id: 'image', icon: 'img', label: 'Image' },
  { id: 'video', icon: 'vid', label: 'Vidéo' },
  { id: 'recipe', icon: 'layers', label: 'Modèles' },
]
// Chaque entrée ouvre la fenêtre de la bibliothèque sur la bonne vue.
const FILES = [
  { view: { tab: 'library', sub: 'all', origin: 'generated' }, icon: 'sparkle', label: 'Mes générations' },
  { view: { tab: 'library', sub: 'all', origin: 'upload' }, icon: 'at', label: 'Mes éléments' },
  { view: { tab: 'favs' }, icon: 'star', label: 'Mes favoris' },
]

/** Barre d'icônes de l'espace de travail : nouvelle création, type de création, fichiers, bibliothèque et recharge. */
export default function Rail({ tab, onTab, onNew }) {
  const { openLibrary } = useLibrary()
  const { openRecharge } = useRecharge()
  const item = (key, label, iconName, props) => (
    <li key={key}>
      <button type="button" className="cx-ri" aria-label={label} title={label} {...props}><Icon name={iconName} size={20} /></button>
    </li>
  )
  return (
    <nav className="cx-rail" aria-label="Espace de travail">
      <Link to="/" className="cx-logo" aria-label="Studio Yeelen, accueil"><img src={icon} alt="" width="34" height="34" /></Link>
      <button type="button" className="cx-new" aria-label="Nouvelle création" title="Nouvelle création" onClick={onNew}><Icon name="plus" size={20} /></button>
      <ul className="cx-rl" aria-label="Type de création">
        {TABS.map((t) => item(t.id, t.label, t.icon, { 'aria-current': tab === t.id ? 'true' : undefined, onClick: () => onTab(t.id) }))}
        {features.audio && (
          <li><Link className="cx-ri" to="/audio" aria-label="Audio" title="Audio"><Icon name="mic" size={20} /></Link></li>
        )}
      </ul>
      <i className="cx-sep" aria-hidden="true" />
      <ul className="cx-rl" aria-label="Mes fichiers">
        {FILES.map((f) => item(f.label, f.label, f.icon, { 'aria-haspopup': 'dialog', onClick: () => openLibrary(f.view) }))}
        {item('lib', 'Bibliothèque', 'folder', { 'aria-haspopup': 'dialog', onClick: () => openLibrary() })}
      </ul>
      <ul className="cx-rl cx-end">
        {item('recharge', 'Recharger mes cauris', 'diamond', { 'aria-haspopup': 'dialog', onClick: () => openRecharge() })}
      </ul>
    </nav>
  )
}
