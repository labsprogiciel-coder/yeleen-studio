import { useEffect, useState } from 'react'
import Icon from '../../lib/icons.jsx'
import icon from '../../assets/brand/yeelen-icon.svg'
import GenerationTray from '../GenerationTray.jsx'
import { Amount } from '../Cauri.jsx'
import { useJobs } from '../../lib/jobs.jsx'
import { useLibrary } from '../../lib/libraryDialog.jsx'
import useTabKeys from '../../lib/useTabKeys.js'
import { inProject, useProjects } from '../../lib/projects.js'
import { RECIPES, recipeById, recipeCost } from '@studio/catalog/recipes'
import { THUMBS, TOURS, toolById } from './tools.js'
import VideoTemplates, { VideoGrid } from './VideoTemplates.jsx'

const VIEWS = [{ id: 'creations', icon: 'sparkle', label: 'Créations' }, { id: 'templates', icon: 'layers', label: 'Modèles' }]
const KINDS = ['video', 'image', 'audio'] // ordre d'affichage des créations en cours

/** Carte d'un workflow : le titre à gauche, la vignette à droite. */
function TemplateCard({ r, onPick }) {
  return (
    <li>
      <button type="button" className="cx-card" onClick={() => onPick(r.id)}>
        <span className="cx-card-t"><b>{r.name}</b><small><Amount n={recipeCost(r.id)} word /></small></span>
        <span className="cx-card-img">
          <img src={THUMBS[r.id]} alt="" loading="lazy" />
          <span className="cx-by"><img src={icon} alt="" width="18" height="18" />Par Yeelen</span>
        </span>
      </button>
    </li>
  )
}

/** Visite guidée de l'outil ouvert : une étape à la fois, avec ses flèches. */
function Tour({ tool }) {
  const t = toolById(tool)
  const r = tool?.startsWith('wf-') ? recipeById(tool) : null
  // Un modèle (workflow) : sa vignette, ce qu'il produit et ce qu'il faut fournir ; un outil : sa visite guidée en étapes.
  const steps = r
    ? [{ img: THUMBS[r.id], title: 'Ce qu’il faut fournir', text: null, need: [...r.photos.map((p) => p.label), ...r.texts.map((x) => x.label + (x.min ? '' : ' (facultatif)'))] }]
    : TOURS[tool]
  const [i, setI] = useState(0)
  useEffect(() => setI(0), [tool])
  if (!t || !steps) return null
  const step = steps[i]
  return (
    <section className="cx-intro" aria-labelledby="cx-intro-h">
      <div className="cx-intro-h">
        <span className={`cx-intro-ic ${t.icon === 'img' ? 'image' : ''}`}>{t.thumb ? <img src={t.thumb} alt="" /> : <Icon name={t.icon} size={20} />}</span>
        <h2 id="cx-intro-h">{t.title}</h2>
      </div>
      <p className="cx-intro-p">{t.desc}</p>
      <div className="cx-deck">
      {steps[i - 1] && <img className="cx-peek prev" src={steps[i - 1].img} alt="" aria-hidden="true" />}
      {steps[i + 1] && <img className="cx-peek next" src={steps[i + 1].img} alt="" aria-hidden="true" />}
      <figure className="cx-step" aria-live="polite">
        <img src={step.img} alt="" />
        <figcaption>
          <b>{step.title}</b>
          {step.text && <span>{step.text}</span>}
          {step.need && <span className="cx-need">{step.need.map((n) => <i key={n}>{n}</i>)}</span>}
        </figcaption>
      </figure>
      </div>
      {steps.length > 1 && <div className="cx-pager">
        <button type="button" onClick={() => setI((n) => n - 1)} disabled={i === 0} aria-label="Étape précédente"><Icon name="chevL" size={16} /></button>
        <span>{i + 1} / {steps.length}</span>
        <button type="button" onClick={() => setI((n) => n + 1)} disabled={i === steps.length - 1} aria-label="Étape suivante"><Icon name="chevR" size={16} /></button>
      </div>}
    </section>
  )
}

/**
 * Zone principale : Créations (les générations en cours et terminées, ou la visite guidée de l'outil tant qu'il n'y en a pas)
 * et Modèles (les vidéos à refaire, puis les workflows en cartes). `top` : bandeau au-dessus des créations (avancement d'un modèle
 * lancé). `templates` : les vidéos à refaire ; `onRecreate` en ouvre une dans le générateur.
 */
export default function Showcase({ view, onView, tool, onPickTemplate, templates = [], onRecreate, top = null }) {
  const { jobs } = useJobs()
  const { openLibrary } = useLibrary()
  const onTabKeys = useTabKeys()
  const { current } = useProjects()
  const kinds = KINDS.filter((k) => jobs.some((j) => j.kind === k && inProject(j, current)))
  return (
    <main className="cx-main" id="main" tabIndex={-1}>
      <div className="cx-mbar">
        <div className="cx-views" role="tablist" aria-label="Affichage" onKeyDown={onTabKeys}>
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" id={`cx-view-${v.id}`} aria-selected={view === v.id} aria-controls="cx-view" tabIndex={view === v.id ? 0 : -1} onClick={() => onView(v.id)}>
              <Icon name={v.icon} size={16} />{v.label}
            </button>
          ))}
        </div>
        <div className="cx-tools">
          <button type="button" className="cx-ib" aria-haspopup="dialog" aria-label="Mes favoris" title="Mes favoris" onClick={() => openLibrary({ tab: 'favs' })}><Icon name="star" size={18} /></button>
          <button type="button" className="cx-ib" aria-haspopup="dialog" aria-label="Chercher dans la bibliothèque" title="Chercher dans la bibliothèque" onClick={() => openLibrary()}><Icon name="search" size={18} /></button>
        </div>
      </div>

      <div className="cx-view" id="cx-view" role="tabpanel" aria-labelledby={`cx-view-${view}`}>
        {view === 'creations' ? (
          <>
            {top}
            {kinds.length > 0 ? kinds.map((k) => <GenerationTray key={k} kind={k} className="cx-tray" />) : <Tour tool={tool} />}
            <section className="cx-sec" aria-labelledby="cx-new-h">
              <div className="cx-sec-h">
                <h2 id="cx-new-h">{kinds.length ? 'Modèles' : 'Commencer à créer'}</h2>
                <button type="button" className="cx-all" onClick={() => onView('templates')}>Tout voir<Icon name="chevR" size={14} /></button>
              </div>
              {!kinds.length && <p className="cx-sub">Des modèles prêts à l’emploi : une photo ou quelques mots, et le reste se fait seul.</p>}
              <ul className="cx-cards">{RECIPES.slice(0, 3).map((r) => <TemplateCard key={r.id} r={r} onPick={onPickTemplate} />)}</ul>
            </section>
            {templates.length > 0 && (
              <section className="cx-sec" aria-labelledby="cx-vt-new-h">
                <div className="cx-sec-h">
                  <h2 id="cx-vt-new-h">Vidéos à refaire</h2>
                  <button type="button" className="cx-all" onClick={() => onView('templates')}>Tout voir<Icon name="chevR" size={14} /></button>
                </div>
                <VideoGrid templates={templates.slice(0, 4)} onPick={onRecreate} />
              </section>
            )}
          </>
        ) : (
          <>
            {templates.length > 0 && <VideoTemplates templates={templates} onPick={onRecreate} />}
            <section className="cx-sec" aria-labelledby="cx-tpl-h">
              <div className="cx-sec-h"><h2 id="cx-tpl-h">Modèles en vedette</h2></div>
              <ul className="cx-cards">{RECIPES.map((r) => <TemplateCard key={r.id} r={r} onPick={onPickTemplate} />)}</ul>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
