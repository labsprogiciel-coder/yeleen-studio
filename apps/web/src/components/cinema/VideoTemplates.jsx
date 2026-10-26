import { useMemo, useRef, useState } from 'react'
import icon from '../../assets/brand/yeelen-icon.svg'
import { Amount } from '../Cauri.jsx'
import { categoryLabel, templateCost } from '../../lib/templates.js'

const PAGE = 12 // cartes montrées avant « Voir plus »
// Les cartes sont en 16:9 ; une vidéo verticale y est montrée entière, sur fond sombre.
const TALL = new Set(['9:16', '3:4', '4:5'])

/** Carte d'une vidéo à refaire : la vidéo (sa première image au repos, lue au survol ou au focus, sans le son), son nom et son prix. */
export function TemplateVideoCard({ t, onPick }) {
  const v = useRef(null)
  const play = () => { const el = v.current; if (el && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) el.play().catch(() => {}) }
  const stop = () => { const el = v.current; if (el) { el.pause(); el.currentTime = 0.1 } } // revient à la première image
  return (
    <li>
      <button type="button" className="cx-vt" onClick={() => onPick(t)} onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop}
        aria-label={`Refaire « ${t.name} »`}>
        <span className={`cx-vt-media${TALL.has(t.ratio) ? ' tall' : ''}`}>
          <video ref={v} src={`${t.video}#t=0.1`} muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
          <span className="cx-by"><img src={icon} alt="" width="18" height="18" />Par Yeelen</span>
        </span>
        <span className="cx-vt-t">
          <b>{t.name}</b>
          <small><Amount n={templateCost(t)} word />{t.photo ? ' · avec votre photo' : ''}</small>
        </span>
      </button>
    </li>
  )
}

/** Toutes les vidéos à refaire, filtrées par catégorie, par pages. */
export default function VideoTemplates({ templates, onPick }) {
  const cats = useMemo(() => [...new Set(templates.map((t) => t.category))], [templates])
  const [cat, setCat] = useState('all')
  const [shown, setShown] = useState(PAGE)
  const list = cat === 'all' ? templates : templates.filter((t) => t.category === cat)
  const choose = (c) => { setCat(c); setShown(PAGE) }
  return (
    <section className="cx-sec" aria-labelledby="cx-vt-h">
      <div className="cx-sec-h"><h2 id="cx-vt-h">Vidéos à refaire</h2></div>
      <p className="cx-sub">Choisissez une vidéo : ses réglages s’ouvrent dans le générateur, ajoutez votre photo ou changez le texte.</p>
      {cats.length > 1 && (
        <div className="cx-cats" role="group" aria-label="Catégories">
          {['all', ...cats].map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => choose(c)}>{c === 'all' ? 'Toutes' : categoryLabel(c)}</button>
          ))}
        </div>
      )}
      <ul className="cx-vts">{list.slice(0, shown).map((t) => <TemplateVideoCard key={t.id} t={t} onPick={onPick} />)}</ul>
      {list.length > shown && <button type="button" className="cx-more" onClick={() => setShown((n) => n + PAGE)}>Voir plus</button>}
    </section>
  )
}
