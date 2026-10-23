import Icon from '../../lib/icons.jsx'
import useTabKeys from '../../lib/useTabKeys.js'
import { TAB_LABEL, TOOLS, toolById } from './tools.js'

/**
 * Panneau gauche : les onglets (Image, Vidéo, Modèles), puis la liste des outils de l'onglet, ou l'outil ouvert avec son
 * en-tête (retour aux outils) et son formulaire (`children`).
 */
export default function ToolPanel({ tab, onTab, tool, onTool, onTemplates, children }) {
  const onTabKeys = useTabKeys()
  const tabs = Object.keys(TOOLS)
  const open = tool ? toolById(tool) : null
  return (
    <aside className="cx-panel" aria-label="Outils">
      <div className="cx-tabs" role="tablist" aria-label="Type de création" onKeyDown={onTabKeys}>
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" id={`cx-tab-${t}`} aria-selected={tab === t} aria-controls="cx-tool" tabIndex={tab === t ? 0 : -1} onClick={() => onTab(t)}>{TAB_LABEL[t]}</button>
        ))}
      </div>

      <div className="cx-tool" id="cx-tool" role="tabpanel" aria-labelledby={`cx-tab-${tab}`}>
        {open ? (
          <>
            <div className={`cx-head cx-head-${tab}`}>
              <div>
                <button type="button" className="cx-back" onClick={() => onTool(null)}><Icon name="chevL" size={14} />Outils</button>
                <h2>{open.title}</h2>
              </div>
              {tab === 'video' && (
                <button type="button" className="cx-tpl" onClick={onTemplates}><Icon name="layers" size={18} />Modèles</button>
              )}
            </div>
            {children}
          </>
        ) : (
          <ul className="cx-list" aria-label={`Outils ${TAB_LABEL[tab]}`}>
            {TOOLS[tab].map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onTool(t.id)}>
                  {t.thumb ? <img className="cx-li-ic img" src={t.thumb} alt="" /> : <span className={`cx-li-ic ${tab}`}><Icon name={t.icon} size={20} /></span>}
                  <span><b>{t.title}</b><small>{t.desc}</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
