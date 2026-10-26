import { useEffect, useMemo, useRef, useState } from 'react'
import icon from '../../assets/brand/yeelen-icon.svg'
import { Amount } from '../Cauri.jsx'
import { categoryLabel, templateCost } from '../../lib/templates.js'

const PAGE = 12 // cartes montrées avant « Voir plus »
/** Proportions de la vidéo (« 9:16 » → [9, 16]) ; 16:9 si le format est « auto » ou inconnu. */
const dims = (ratio) => (/^\d+:\d+$/.test(ratio ?? '') ? ratio.split(':').map(Number) : [16, 9])
const aspect = (ratio) => dims(ratio).join(' / ')
const COL = 250 // largeur minimale d'une colonne (sur une carte basse, la description cède la place : voir studio.css)
const GAP = 12

/**
 * Grille des cartes, chacune au format de sa vidéo : les cartes vont, dans l'ordre, dans la colonne la moins haute (autant de
 * colonnes que la largeur en permet), pour que les verticales et les horizontales se mêlent sans trous.
 */
export function VideoGrid({ templates, onPick }) {
  const box = useRef(null)
  const [cols, setCols] = useState(2)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setCols(Math.max(1, Math.floor((e.contentRect.width + GAP) / (COL + GAP)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const columns = useMemo(() => {
    const out = Array.from({ length: cols }, () => ({ h: 0, items: [] }))
    for (const t of templates) {
      const c = out.reduce((a, b) => (b.h < a.h ? b : a))
      const [w, h] = dims(t.ratio)
      c.items.push(t); c.h += h / w
    }
    return out
  }, [templates, cols])
  return (
    <div className="cx-vts" ref={box} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {columns.map((c, i) => <ul key={i} className="cx-vcol">{c.items.map((t) => <TemplateVideoCard key={t.id} t={t} onPick={onPick} />)}</ul>)}
    </div>
  )
}
/**
 * Carte d'une vidéo à refaire, au format de sa vidéo (9:16 pour une verticale) : la vidéo seule, qui remplit la carte (sa première
 * image au repos). Au survol ou au focus, elle se lit
 * sans le son et laisse paraître le titre, la description et « Refaire » (avec le prix). Sur écran tactile, ces textes restent visibles.
 */
export function TemplateVideoCard({ t, onPick }) {
  const v = useRef(null)
  const play = () => { const el = v.current; if (el && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) el.play().catch(() => {}) }
  const stop = (e) => { if (e?.currentTarget.contains(e.relatedTarget)) return; const el = v.current; if (el) { el.pause(); el.currentTime = 0.1 } } // revient à la première image
  const id = `cx-vt-${t.id}`
  return (
    <li className="cx-vt" style={{ aspectRatio: aspect(t.ratio) }} onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop} aria-labelledby={id}>
      <video ref={v} src={`${t.video}#t=0.1`} muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
      <span className="cx-by"><img src={icon} alt="" width="18" height="18" />Par Yeelen</span>
      <div className="cx-vt-over">
        <h3 id={id}>{t.name}</h3>
        {t.blurb && <p>{t.blurb}</p>}
        <button type="button" onClick={() => onPick(t)} aria-describedby={id}>
          Refaire<span className="cx-vt-price"><Amount n={templateCost(t)} word /></span>
        </button>
      </div>
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
      <VideoGrid templates={list.slice(0, shown)} onPick={onPick} />
      {list.length > shown && <button type="button" className="cx-more" onClick={() => setShown((n) => n + PAGE)}>Voir plus</button>}
    </section>
  )
}
