import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../lib/icons.jsx'
import { IMAGE_MODELS, VIDEO_MODELS, findModel, imageCost, priceLabel, videoCost } from '@studio/catalog'
import { recipeById, recipeCost } from '@studio/catalog/recipes'
import { findTool } from '@studio/catalog/tools'
import { SkipLink } from '../components/Headers.jsx'
import Menu from '../components/Menu.jsx'
import MentionTextarea from '../components/MentionTextarea.jsx'
import PlanTabs from '../components/PlanTabs.jsx'
import Segmented from '../components/Segmented.jsx'
import { Section, AddMedia, RefTile, PromptBox, GenerateButton, StyleSection } from '../components/GenPanel.jsx'
import { StyleChip } from '../components/StyleChip.jsx'
import { findStyle } from '@studio/catalog/styles'
import BrandToggle from '../components/BrandToggle.jsx'
import { features } from '../lib/features.js'
import ModelLogo from '../components/ModelLogo.jsx'
import Rail from '../components/cinema/Rail.jsx'
import { readRail, saveRail } from '../lib/railPrefs.js'
import ToolPanel from '../components/cinema/ToolPanel.jsx'
import Showcase from '../components/cinema/Showcase.jsx'
import { TOOLS, tabOf } from '../components/cinema/tools.js'
import ProjectPicker from '../components/cinema/ProjectPicker.jsx'
import { CreateLeft } from './video/CreateTab.jsx'
import AudioPanel from './audio/AudioPanel.jsx'
import ToolForm, { toolJobs } from '../components/cinema/ToolForm.jsx'
import GenjutsuForm from '../components/cinema/GenjutsuForm.jsx'
import AssetModal from '../components/cinema/AssetModal.jsx'
import { RecipeForm, RunStrip } from '../components/cinema/Recipes.jsx'
import { useAssets } from '../lib/assets.jsx'
import { useBrand } from '../lib/brand.jsx'
import { useHandoff } from '../lib/handoff.jsx'
import { jetons, useJobs } from '../lib/jobs.jsx'
import { ATTACH_PATTERN, labelAttachments, resolveAttachments } from '../lib/mentions.js'
import { logoFor } from '../lib/modelLogos.js'
import { modelItem } from '../lib/modelItem.js'
import { useToast } from '../lib/toasts.jsx'
import useDocumentTitle from '../lib/useDocumentTitle.js'
import useGenSettings from '../lib/useGenSettings.js'
import { loadTemplates, useTemplates, withInputs } from '../lib/templates.js'
import { TOKEN_PATTERN, blockerText, generatedCost, missingInputs, sentInputs, todoText, tokenItems, tplInputs, tplParam, tplRatio } from '../lib/templateRun.js'
import TemplateInputs from '../components/cinema/TemplateInputs.jsx'
import { api } from '../lib/api.js'
import useIsAdmin from '../lib/useIsAdmin.jsx'
import '../styles/shell.css'
import { track } from '../lib/posthog.js'
import '../styles/library.css'
import '../styles/cinema.css'
import '../styles/studio.css'

// Le modèle audio vers vidéo se pilote par un fichier audio : il a sa place dans l'écran Vidéo, pas ici.
const VIDEO_LIST = VIDEO_MODELS.filter((m) => m.input !== 'audio')
const STYLES_VIEW = { tab: 'styles' } // la fenêtre des références ouverte sur ses styles (objet fixe : la fenêtre ne se réinitialise pas à chaque rendu)
const CINEMA = ['seedance-2-5', 'kling-3-pro', 'h3-max'] // modèles pensés pour le récit : références, personnages, plans fidèles au texte
const rank = (id) => (CINEMA.includes(id) ? CINEMA.indexOf(id) : CINEMA.length)
const VIDEO_ITEMS = [...VIDEO_LIST]
  .sort((a, b) => rank(a.id) - rank(b.id))
  .map((m) => ({ ...modelItem(m, 'video'), group: CINEMA.includes(m.id) ? 'Modèles cinéma' : 'Autres modèles' }))
const IMAGE_ITEMS = IMAGE_MODELS.map((m) => modelItem(m, 'image'))
const MODES = [
  { id: 'refs', icon: 'layers', title: 'Références' },
  { id: 'next', icon: 'extend', title: 'Suite' },
  { id: 'prev', icon: 'revert', title: 'Avant' },
  { id: 'edit', icon: 'wand', title: 'Modifier la vidéo' },
]
const nextOf = (list, v) => list[(list.indexOf(v) + 1) % list.length]

export default function Cinema() {
  useDocumentTitle('Studio cinéma')
  const toast = useToast()
  const { jobs, submit, balance } = useJobs()
  const { assets, pool, adopt, getFile } = useAssets()
  const { pending, sendTo, take } = useHandoff()
  const { brand: kit, style } = useBrand()
  const area = useRef(null)
  // Onglet du panneau (image, video, recipe), outil ouvert (null : la liste des outils) et vue de la zone principale.
  const [tab, setTab] = useState('video')
  const [tool, setTool] = useState(null)
  const [view, setView] = useState('creations')
  // Barre latérale réduite ou agrandie : enregistré seulement quand la personne clique (sinon la largeur de la fenêtre décide).
  const [railCollapsed, setRailCollapsed] = useState(readRail)
  const toggleRail = () => setRailCollapsed((v) => { const next = !v; saveRail(next); return next })
  const mode = tab === 'recipe' ? 'recipe' : tool === 'image' ? 'image' : 'video'
  const [itext, setItext] = useState('') // texte de l'image ; en vidéo, chaque plan porte le sien (s.plans)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(null) // 'recent' | 'video' | 'styles' : la fenêtre des références est ouverte (sur cet onglet)
  const [styleId, setStyleId] = useState(null) // style « By Yeleen » : l'API ajoute sa consigne au texte (voir packages/catalog/src/styles.js)
  const look = findStyle(styleId)
  const [att, setAtt] = useState([]) // pièces jointes : [{ id, assetId }], dans l'ordre d'ajout

  // Vidéo : le panneau de réglages partagé avec l'écran Vidéo (durées, résolutions, formats, son selon le modèle)
  const [videoId, setVideoId] = useState(CINEMA[0])
  const [task, setTask] = useState('refs') // modèle à références : 'refs' (références), 'next' (prolonger la vidéo jointe), 'edit' (la modifier)
  const vmodel = findModel(VIDEO_LIST, videoId)
  const s = useGenSettings(vmodel)
  // Vidéos à refaire : un clic ouvre « Références et montage » avec le modèle et les réglages de l'exemple. Ils sont appliqués une
  // fois le modèle en place (`tpl`), après que useGenSettings a ramené ses valeurs à celles du modèle (son effet passe avant).
  const templates = useTemplates(VIDEO_LIST)
  const [tpl, setTpl] = useState(null)
  // La vidéo à refaire ouverte (tant que « Références et montage » l'est) et ses entrées (voir lib/templateRun.js) : `tin` les fichiers
  // remplis { [idx]: asset } ; les images `generated` se font en deux temps, comme chez Krea : Krea 3 les crée (consigne `tprompts`,
  // à partir de la photo de leur entrée `source` s'il y en a une), puis elles remplissent leur case. `tgens` : { [idx]: { jobId, key } }.
  const [startTpl, setStartTpl] = useState(null)
  const [genTpl, setGenTpl] = useState(null) // vidéo à refaire par Genjutsu (Transfert de mouvement, Remplacer un objet), tant que son outil est ouvert
  const [tin, setTin] = useState({})
  const [tprompts, setTprompts] = useState({})
  const [tgens, setTgens] = useState({})
  // Chaque ouverture (ou fermeture) d'une vidéo à refaire change `tplAct` : une image demandée pour une autre ne part pas, ni ne remplit
  // la case de celle-ci (la lecture de la photo peut finir après le changement).
  const tplAct = useRef(0)
  useEffect(() => { tplAct.current += 1 }, [startTpl])
  useEffect(() => {
    if (!tpl || vmodel.id !== tpl.modelId) return
    s.replacePlans((vmodel.caps.multiShot ? tpl.plans : tpl.plans.slice(0, 1)).map((p) => ({ text: p.text, dur: p.dur })))
    if (tpl.resolution && s.resolutions?.includes(tpl.resolution)) s.setRes(tpl.resolution)
    if (tpl.ratio && s.ratios?.includes(tpl.ratio)) s.setRatio(tpl.ratio)
    if (vmodel.caps.audio !== 'always') s.setSound(tpl.sound)
    tplAct.current += 1; setStartTpl(tpl); setTin({}); setTgens({})
    setTprompts(Object.fromEntries(tplInputs(tpl).filter((i) => i.mode === 'generated').map((i) => [i.idx, i.prompt ?? ''])))
    toast(`« ${tpl.name} » est prêt. ${todoText(tpl)}`)
    setTpl(null)
  }, [tpl, vmodel.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Image
  const [imageId, setImageId] = useState(IMAGE_MODELS[0].id)
  const imodel = findModel(IMAGE_MODELS, imageId)
  const [iRatio, setIRatio] = useState('Auto')
  const [iRes, setIRes] = useState('2K')
  const [iCount, setICount] = useState(1)
  const iRes2 = imodel.caps.resolutions.includes(iRes) ? iRes : imodel.caps.resolutions.includes('2K') ? '2K' : imodel.caps.resolutions[0]
  const iRatio2 = imodel.caps.ratios.includes(iRatio) ? iRatio : imodel.caps.ratios[0] // Krea 3 n'a pas « Auto »
  const iN = Math.min(iCount, imodel.caps.maxImages)

  // Modèles : une photo et quelques mots donnent plusieurs plans ; chaque plan est une génération vidéo
  const [recipeId, setRecipeId] = useState(null)
  const [rtext, setRtext] = useState({})
  const [photos, setPhotos] = useState({}) // une photo par entrée du modèle : { photo } ou { model, garment }
  const [run, setRun] = useState(null) // { id, recipeId, shots } : le modèle en cours
  const [rerror, setRerror] = useState('')
  const recipe = mode === 'recipe'
  const examples = (id) => Object.fromEntries(recipeById(id).texts.map((t) => [t.key, t.example ?? '']))
  const pickRecipe = (id) => { setRecipeId(id); setRtext(examples(id)); setRerror('') }
  // Un outil s'ouvre dans son onglet ; un modèle (workflow) prépare aussi son formulaire.
  const openTool = (id) => {
    setError('')
    if (id !== 'video-refs') setStartTpl(null) // l'image de départ d'une vidéo à refaire ne vaut que pour elle
    setGenTpl(null) // une vidéo à refaire par Genjutsu ne vaut que tant que son outil est ouvert (recreate la remet)
    if (!id) return setTool(null)
    const t = tabOf(id)
    setTab(t); setTool(id)
    track('tool_opened', { tool: id, tab: t })
    if (t === 'recipe') pickRecipe(id)
  }
  const recreate = (t) => {
    track('template_used', { template: t.id, genjutsu: Boolean(t.genjutsu), model: t.genjutsu?.tool ?? t.modelId ?? null })
    if (t.genjutsu) { openTool(t.genjutsu.tool); setGenTpl(t); setView('creations'); return } // la vidéo est la source : seulement des photos
    openTool('video-refs'); setTask('refs'); setAtt([]); setStyleId(null); setVideoId(t.modelId); setTpl(t); setView('creations') // la vidéo à refaire a déjà son rendu
  }
  // Lien direct `?tpl=<id>` (« Essayer sur mon compte » de l'administration) : la vidéo à refaire publiée, sinon, pour un compte
  // administrateur, le modèle non publié tel que Cinéma le recevrait (marqué `preview`). Le paramètre est retiré une fois appliqué.
  const [params, setParams] = useSearchParams()
  const linkId = tplParam(params.toString())
  const { ready: adminReady, admin } = useIsAdmin()
  const linked = useRef(null)
  useEffect(() => {
    if (!linkId || linked.current === linkId) return
    let alive = true
    let asking = false // aperçu demandé, réponse pas encore là : si le lien change, l'ancienne réponse est ignorée et le lien relu
    const usable = (t) => (t.genjutsu ? Boolean(findTool(t.genjutsu.tool)) : VIDEO_LIST.some((m) => m.id === t.modelId))
    const done = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('tpl'); return n }, { replace: true })
    loadTemplates().then(async (all) => {
      if (!alive) return
      const found = all.find((t) => t.id === linkId && usable(t))
      if (found) { linked.current = linkId; recreate(found); return done() }
      if (!adminReady) return // on attend la réponse sur les droits avant de conclure
      linked.current = linkId
      if (!admin) { toast('Cette vidéo à refaire n’est pas disponible.'); return done() }
      asking = true
      let t = null
      try { t = withInputs({ ...(await api.adminPreviewTemplate(linkId)).template, preview: true }) } catch { /* dit plus bas */ }
      asking = false
      if (!alive) return // lien changé entre-temps : la réponse ne remplace pas la vidéo plus récente
      if (!t) toast('Impossible d’ouvrir l’aperçu de ce modèle.')
      else if (!usable(t)) toast('Le modèle de cette vidéo à refaire n’est plus au catalogue.')
      else recreate(t)
      done()
    })
    return () => { alive = false; if (asking && linked.current === linkId) linked.current = null }
  }, [linkId, adminReady, admin]) // eslint-disable-line react-hooks/exhaustive-deps
  // Changer d'onglet montre la liste de ses outils.
  const openTab = (t) => { setError(''); setTab(t); setTool(null); setStartTpl(null); setGenTpl(null) }
  useEffect(() => { // « Envoyer vers » un modèle : l'image arrive comme photo de départ, même si Cinéma est déjà ouvert
    if (pending?.target !== 'cinema.recipe') return
    const h = take('cinema.recipe')
    const a = h && pool.find((x) => x.id === h.assetId)
    if (!a) return
    openTool(h.recipeId); setPhotos({ [recipeById(h.recipeId).photos[0].key]: a })
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps
  const runJobs = run ? jobs.filter((j) => j.spec?.recipe?.runId === run.id) : []
  const video = mode === 'video'
  const text = video ? s.current.text : itext
  const setText = (v) => (video ? s.patch(s.active, { text: v }) : setItext(v))
  const model = video ? vmodel : imodel
  const caps = vmodel.caps
  const styled = features.brand && kit.apply && Boolean(style) // sans l'écran Marque, personne ne peut régler (ni retirer) un style de marque
  const attached = useMemo(() => labelAttachments(att, pool), [att, pool])
  const ref = useMemo(() => resolveAttachments({ attached, texts: video ? s.plans.map((p) => p.text) : [itext], caps }), [attached, s.plans, itext, video, caps])
  // Vidéo à refaire avec des entrées : elles remplacent les pièces jointes libres (la numérotation doit suivre le texte du modèle).
  const tplIn = useMemo(() => tplInputs(startTpl), [startTpl])
  const hasIn = video && tool === 'video-refs' && tplIn.length > 0 && vmodel.id === startTpl.modelId
  const tplTokens = useMemo(() => tokenItems(tplIn), [tplIn])
  const missing = hasIn ? missingInputs(tplIn, tin) : []
  const roles = hasIn ? {} : Object.fromEntries(ref.items.map((i) => [i.token, i.role]))
  const items = hasIn
    ? tplTokens.map((x) => ({ key: `tpl-${x.idx}`, token: x.token, label: x.token, sub: x.title, asset: tin[x.idx] }))
    : attached.map((x) => ({ key: x.id, token: x.token, label: x.token, sub: x.asset.name, asset: x.asset }))
  const native = Boolean(caps.references) // le modèle prolonge ou modifie lui-même une vidéo jointe
  const activeTask = native && !hasIn ? task : 'refs' // une vidéo à refaire part de ses entrées
  // Suite, Avant et Modifier d'un modèle sans prise en charge native passent par l'écran Vidéo : sans lui, seul « Références » reste (et le menu disparaît).
  const modeItems = native ? MODES.filter((m) => m.id !== 'prev') : features.video ? MODES : MODES.filter((m) => m.id === 'refs')
  const clipSecs = hasIn // durée des vidéos jointes (ou fournies pour le modèle) : facturée en entrée
    ? tplIn.filter((i) => i.slot === 'reference' && i.kind === 'video').reduce((n, i) => n + (tin[i.idx]?.secs || 0), 0)
    : ref.references.filter((r) => r.kind === 'video').reduce((n, r) => n + (r.asset.secs || 0), 0)
  const secs = activeTask === 'edit' ? Math.max(4, Math.ceil(clipSecs)) : s.total // modifier : la sortie dure autant que la vidéo
  const cost = video ? (native ? videoCost(vmodel, secs, s.res, { inputSecs: clipSecs, sound: s.sound }) : s.cost) : imageCost(imodel, iRes2, iN)

  // Ce qui manque pour lancer, dit en clair sous le texte.
  const needsStart = video && !hasIn && caps.startFrame === 'required' && !ref.slots.start // avec un modèle : ses entrées le disent
  const needsClip = video && !hasIn && native && activeTask !== 'refs' && !attached.some((x) => x.asset.kind === 'video')
  const needs = hasIn && missing.length ? blockerText(missing) : needsClip ? `Joignez une vidéo avec + : elle sera ${activeTask === 'next' ? 'prolongée' : 'modifiée'}.` : needsStart && text.trim() ? 'Ce modèle part d’une image : ajoutez-en une avec +.' : null // l'image est réclamée une fois que l'on a commencé à écrire
  const idle = video && attached.length > 0 && ref.items.every((i) => i.role === 'unused') ? 'Ce modèle n’utilise pas ces références.' : null
  const planHint = video && s.multi && s.plans.findIndex((p) => !p.text.trim()) >= 0 && s.current.text.trim() ? `Décrivez aussi le plan ${s.plans.findIndex((p) => !p.text.trim()) + 1}.` : null
  const emptyPlan = video ? s.plans.findIndex((p) => !p.text.trim()) : (itext.trim() ? -1 : 0) // premier plan sans texte
  const blocked = emptyPlan >= 0 || needsStart || needsClip || missing.length > 0
  const long = text.length > 600 ? `${text.length.toLocaleString('fr-FR')} caractères` : null // information : les modèles coupent ou ignorent les prompts très longs

  const attach = (list) => {
    adopt(list.filter((a) => a.source === 'yeleen')) // les éléments de la Bibliothèque Yeleen se joignent comme les autres références
    return setAtt((x) => [...x, ...list.filter((a) => !x.some((y) => y.assetId === a.id)).map((a) => ({ id: crypto.randomUUID(), assetId: a.id }))])
  }
  const detach = (id) => {
    const gone = attached.find((x) => x.id === id)
    setAtt((x) => x.filter((y) => y.id !== id))
    const drop = (t) => t.replace(new RegExp(`@${gone.token}(?!\\d) ?`, 'g'), '') // une pièce retirée ne reste pas citée
    if (gone) { if (video) s.plans.forEach((p, i) => s.patch(i, { text: drop(p.text) })); else setItext(drop) }
  }

  const generate = async () => {
    setError('')
    if (!video) {
      const live = { kind: 'image', modelId: imodel.id, prompt: text.trim(), resolution: iRes2, ratio: iRatio2, count: iN, style: look?.id, brandStyle: styled ? style : undefined }
      const r = submit({ kind: 'image', title: imodel.name, prompt: text.trim(), count: iN, cost, live, brandStyle: styled ? style : undefined, meta: `${iN} × ${iRes2}${iRatio2 === 'Auto' ? '' : ` · ${iRatio2}`}${look ? ` · ${look.label}` : ''}${styled ? ' · style de la marque' : ''}` })
      return setError(r.ok ? '' : `Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
    }
    if (hasIn) return generateTemplate()
    // Vidéo : les pièces jointes deviennent références (Seedance), image de départ, image de fin, audio ou éléments selon le modèle.
    let extra
    try {
      const get = (a) => (a ? getFile(a) : null)
      const [start, end, audio] = await Promise.all([get(ref.slots.start), get(ref.slots.end), get(ref.slots.audio)])
      const elements = await Promise.all(ref.elements.map(async (a) => ({ kind: a.kind, file: await getFile(a) })))
      const references = await Promise.all(ref.references.map(async (r) => ({ kind: r.kind, file: await getFile(r.asset) })))
      extra = { start, end, audio, elements, references }
    } catch {
      return setError('Une référence est introuvable : réimportez-la ou retirez-la.')
    }
    const total = Math.round(secs * 10) / 10
    const live = {
      kind: 'video', modelId: vmodel.id, plans: s.plans.map((p, i) => ({ text: ref.texts[i], dur: p.dur })), secs: total,
      resolution: s.resolutions ? s.res : undefined, ratio: s.ratios ? s.ratio : undefined, fps: caps.fps ? s.fps : undefined, sound: s.sound, camera: 'none',
      style: look?.id,
      brandStyle: styled ? style : undefined,
      files: { start: caps.startFrame !== 'none' ? extra.start : null, end: caps.endFrame ? extra.end : null, audio: caps.audioRef ? extra.audio : null },
      elements: extra.elements.length ? extra.elements : undefined,
      references: extra.references.length ? extra.references : undefined,
      task: native ? { refs: 'reference', next: 'extension', edit: 'editing' }[activeTask] : undefined,
      inputSecs: clipSecs || undefined,
    }
    const base = `${vmodel.name}${activeTask === 'next' ? ' · suite' : activeTask === 'edit' ? ' · modification' : ''} · ${String(total).replace('.', ',')} s${s.resolutions ? ` · ${s.res}` : ''}${look ? ` · ${look.label}` : ''}`
    const r = submit({ kind: 'video', title: vmodel.name, prompt: s.plans.map((p) => p.text.trim()).join(' / '), cost, secs: total, live, brandStyle: styled ? style : undefined, meta: styled ? `${base} · style de la marque` : base })
    setError(r.ok ? '' : `Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
  }

  // Vidéo à refaire avec des entrées : le serveur place les fichiers selon le modèle (et ajoute ceux fournis par Qreativ) ; on n'envoie
  // que ceux de l'utilisateur et les images créées, avec leur numéro. Plans, résolution, format, son et style restent ceux du panneau.
  const generateTemplate = async () => {
    let templateInputs
    try {
      templateInputs = await Promise.all(sentInputs(tplIn, tin).map(async ({ idx, value }) => ({ idx, file: await getFile(value) })))
    } catch {
      return setError('Un fichier de la vidéo à refaire est introuvable : choisissez-le de nouveau.')
    }
    const total = Math.round(secs * 10) / 10
    const live = {
      kind: 'video', modelId: vmodel.id, template: startTpl.id, templateInputs,
      plans: s.plans.map((p) => ({ text: p.text, dur: p.dur })), secs: total,
      resolution: s.resolutions ? s.res : undefined, ratio: s.ratios ? s.ratio : undefined, fps: caps.fps ? s.fps : undefined, sound: s.sound, camera: 'none',
      style: look?.id,
      brandStyle: styled ? style : undefined,
      inputSecs: clipSecs || undefined,
    }
    const base = `${startTpl.name} · ${vmodel.name} · ${String(total).replace('.', ',')} s${s.resolutions ? ` · ${s.res}` : ''}${look ? ` · ${look.label}` : ''}`
    const r = submit({ kind: 'video', title: startTpl.name, prompt: s.plans.map((p) => p.text.trim()).join(' / '), cost, secs: total, live, brandStyle: styled ? style : undefined, meta: styled ? `${base} · style de la marque` : base })
    setError(r.ok ? '' : `Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
  }

  // Images créées d'abord (entrées `generated`) : Krea 3 retouche la photo de leur entrée `source` au format de la vidéo, ou crée
  // l'image du texte seul. Prête, l'image remplit sa case.
  const kRatio = tplRatio(startTpl)
  const tcosts = Object.fromEntries(tplIn.filter((i) => i.mode === 'generated').map((i) => [i.idx, generatedCost(i, kRatio)]))
  const tbusy = Object.fromEntries(Object.keys(tgens).map((k) => [k, true]))
  const sending = useRef(new Set()) // envois en cours (lecture de la photo comprise) : un second clic ne lance pas une seconde image payante
  const makeImage = async (idx) => {
    if (sending.current.has(idx) || tgens[idx]) return
    sending.current.add(idx)
    try { await sendImage(idx) } finally { sending.current.delete(idx) }
  }
  const sendImage = async (idx) => {
    setError('')
    const i = tplIn.find((x) => x.idx === idx)
    const what = i.slot === 'end' ? 'l’image de fin' : 'l’image de début'
    const prompt = (tprompts[idx] ?? '').trim()
    if (!prompt) return setError(`Décrivez ${what}.`)
    const title = `${startTpl.name} · ${i.slot === 'end' ? 'image de fin' : 'image de début'}`
    const act = tplAct.current
    let r
    if (i.from != null) {
      const photo = tin[i.from]
      if (!photo) return setError('Ajoutez d’abord la photo demandée dans Références.')
      let file
      try { file = await getFile(photo) } catch { return tplAct.current === act && setError('La photo est introuvable : choisissez-la de nouveau.') }
      if (tplAct.current !== act) return // autre vidéo à refaire entre-temps : rien n'est lancé (ni payé)
      r = submit({ kind: 'image', title, prompt, cost: tcosts[idx], meta: `Krea 3 · ${kRatio}`,
        live: { kind: 'tool', modelId: 'template-image', inputs: { model: 'krea-3', prompt, ratio: kRatio }, inputFiles: { images: [file] } } })
    } else {
      r = submit({ kind: 'image', title, prompt, cost: tcosts[idx], count: 1, meta: `Krea 3 · ${kRatio}`,
        live: { kind: 'image', modelId: 'krea-3', prompt, resolution: '2K', ratio: kRatio, count: 1 } })
    }
    if (!r.ok) return setError(`Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
    setTgens((g) => ({ ...g, [idx]: { jobId: r.job.id, key: r.job.key, act } }))
  }
  // Image prête : elle remplit sa case. Vidéo à refaire quittée (ou changée) entre-temps : l'image reste dans Créations seulement.
  const tready = Object.entries(tgens).map(([idx, g]) => [Number(idx), pool.find((a) => a.id === `${g.key}-0`), g.act]).filter(([, a]) => a)
  const treadyKey = tready.map(([idx, a]) => `${idx}:${a.id}`).join(',')
  useEffect(() => {
    if (!tready.length) return
    setTgens((g) => Object.fromEntries(Object.entries(g).filter(([k]) => !tready.some(([idx]) => idx === Number(k)))))
    const fill = tready.filter(([, , act]) => act === tplAct.current) // demandée pour cette ouverture-ci de la vidéo à refaire
    if (!startTpl || !fill.length) return
    setTin((x) => ({ ...x, ...Object.fromEntries(fill.map(([idx, a]) => [idx, a])) }))
    toast(fill.some(([idx]) => tplIn.find((i) => i.idx === idx)?.slot === 'end') ? 'Image de fin prête : elle est dans Références.' : 'Image de début prête : elle est dans Références.')
  }, [treadyKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const tfailed = Object.entries(tgens).map(([idx, g]) => [Number(idx), jobs.find((j) => j.id === g.jobId)]).filter(([, j]) => j && (j.status === 'FAILED' || j.status === 'CANCELED'))
  const tfailedKey = tfailed.map(([idx, j]) => `${idx}:${j.id}`).join(',')
  useEffect(() => { // échec (remboursé par le serveur) ou annulation : on peut relancer
    if (!tfailed.length) return
    setTgens((g) => Object.fromEntries(Object.entries(g).filter(([k]) => !tfailed.some(([idx]) => idx === Number(k)))))
    setError(tfailed.some(([, j]) => j.status === 'FAILED')
      ? 'L’image n’a pas pu être créée (vous avez été remboursé) : réessayez ou changez la consigne.'
      : 'La création de l’image a été annulée : relancez-la quand vous voulez.')
  }, [tfailedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Suite, Avant, Modifier : ces gestes partent d'une vidéo, ils reprennent l'outil de l'écran Vidéo avec celle que vous avez jointe.
  const fromClip = (id) => {
    if (id === 'refs') return
    const clip = attached.find((x) => x.asset.kind === 'video')
    if (!clip) { toast('Joignez d’abord une vidéo avec +.'); return setPicking('video') }
    sendTo({ target: 'video.edit', tool: id === 'edit' ? 'edit' : 'extend', direction: id === 'prev' ? 'start' : undefined, assetId: clip.asset.id }, id === 'edit' ? 'Vidéo envoyée vers Modifier' : 'Vidéo envoyée vers Modifier · Prolonger')
  }

  // Lance le workflow : un seul envoi ; les photos sont déposées chez le fournisseur par le moteur de générations.
  const runRecipe = async () => {
    setRerror('')
    const r = recipeById(recipeId)
    const cost = recipeCost(recipeId)
    if (cost > balance) return setRerror(`Solde insuffisant : il manque ${jetons(Math.ceil((cost - balance) * 10) / 10)} cauris.`)
    let inputFiles
    try {
      inputFiles = Object.fromEntries(await Promise.all(r.photos.map(async (p) => [p.key, p.list ? [await getFile(photos[p.key])] : await getFile(photos[p.key])])))
    } catch { return setRerror('Une photo est introuvable : choisissez-la de nouveau.') }
    const inputs = Object.fromEntries(r.texts.map((t) => [t.key, (rtext[t.key] ?? '').trim()]))
    const id = crypto.randomUUID()
    const live = { kind: 'workflow', modelId: r.workflow.id, inputs, inputFiles }
    const res = submit({ kind: 'video', title: r.name, prompt: Object.values(inputs).filter(Boolean).join(' → ') || r.blurb, cost, live, recipe: { runId: id, step: 0, label: r.name }, meta: r.name })
    if (!res.ok) return setRerror(`Solde insuffisant : il manque ${jetons(res.missing)} cauris.`)
    setRun({ id, recipeId })
  }

  const modelItems = video ? VIDEO_ITEMS : IMAGE_ITEMS
  const modelValue = video ? videoId : imageId
  // Autre modèle vidéo : la vidéo à refaire (faite pour son modèle) n'est plus suivie, comme avec son ×.
  const onModel = video ? (id) => { if (startTpl && id !== startTpl.modelId) setStartTpl(null); setVideoId(id) } : setImageId
  const logo = logoFor(model.id)
  const durations = s.picks.map((d) => ({ id: d, title: `${d} s` }))

  // Le formulaire des outils « Générateur d'images » et « Références et montage », sur le modèle du Générateur de vidéos.
  const hint = needs || planHint || idle || long
  const composer = (
    <div className="ep">
      <Section id="cn-model" title="Modèle">
        <Menu items={modelItems} value={modelValue} onChange={onModel} label={video ? 'Modèle vidéo' : 'Modèle image'} menuWidth={460} search="Rechercher un modèle…">
          {logo ? <ModelLogo logo={logo} size={18} /> : <Icon name="sparkle" size={18} />}<span className="ep-ell">{model.name}</span><span className="ep-price">{priceLabel(model)}</span>
        </Menu>
      </Section>

      {video && !hasIn && modeItems.length > 1 && (
        <Section id="cn-mode" title="Mode">
          <Segmented items={modeItems} value={activeTask} onChange={native ? setTask : fromClip} label="Mode de création" />
        </Section>
      )}

      {video && (
        <Section id="cn-refs" title="Références">
          {!hasIn && attached.length > 0 && (
            <div className="ep-tiles">
              {attached.map((x) => (
                <RefTile key={x.id} asset={x.asset} token={x.token} off={roles[x.token] === 'unused'} onCite={() => area.current?.insertAt(x.token)} onRemove={() => detach(x.id)} />
              ))}
            </div>
          )}
          {startTpl && (
            <div className="ep-from">
              <video src={`${startTpl.video}#t=0.1`} muted loop playsInline preload="metadata" aria-hidden="true" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
              <span><small>{startTpl.preview ? 'Aperçu : modèle non publié' : 'D’après la vidéo'}</small><b>{startTpl.name}</b></span>
              <button type="button" className="ep-x" aria-label={`Ne plus suivre « ${startTpl.name} »`} title="Continuer sans cette vidéo" onClick={() => setStartTpl(null)}><Icon name="close" size={12} /></button>
            </div>
          )}
          {hasIn && (
            <TemplateInputs inputs={tplIn} given={tin} onGiven={(idx, a) => { setTin((x) => ({ ...x, [idx]: a ?? undefined })); setError('') }}
              prompts={tprompts} onPrompt={(idx, v) => { setTprompts((x) => ({ ...x, [idx]: v })); setError('') }}
              busy={tbusy} costs={tcosts} onMake={makeImage} onCite={(tok) => area.current?.insertAt(tok)} />
          )}
          {look && <StyleChip style={look} onOpen={() => setPicking('styles')} onClear={() => setStyleId(null)} />}
          {hasIn
            ? !look && <button type="button" className="ep-add" aria-haspopup="dialog" onClick={() => setPicking('styles')}><span className="ep-chips" aria-hidden="true"><i><Icon name="palette" size={14} /></i></span><span>Choisir un style</span></button>
            : <AddMedia label="Ajouter des références" onAdd={attach} style={styleId} onStyle={setStyleId} />}
        </Section>
      )}

      {!video && <StyleSection id="cn-style" value={styleId} onChange={setStyleId} />}

      <section className="ep-sec" aria-labelledby="cn-plan-h">
        {video && caps.multiShot
          ? <div className="ep-row"><PlanTabs s={s} controls="cn-plan" headingId="cn-plan-h" /></div>
          : <h2 id="cn-plan-h">{video ? 'Plan' : 'Description'}</h2>}
        <PromptBox
          id="cn-plan" role={video && s.multi ? 'tabpanel' : undefined} aria-labelledby={video && s.multi ? `plan-tab-${s.active}` : undefined}
          canClear={Boolean(text)} onClear={() => setText('')} clearLabel={video ? 'Effacer le plan' : 'Effacer la description'}
          enhance={{ value: text, onChange: (t) => { setText(t); setError('') }, kind: video ? 'video' : 'image', modelId: model.id }}
          note={hint && <p className="ep-refnote" role="status">{hint}</p>}
          foot={video && <button type="button" className="ep-at" aria-label="Citer une référence" onClick={() => area.current?.insertAt()}><Icon name="at" size={16} /></button>}
        >
          <MentionTextarea
            ref={area}
            mentions={Boolean(video)}
            value={text}
            onChange={(t) => { setText(t); setError('') }}
            items={video ? items : []}
            pattern={hasIn ? TOKEN_PATTERN : ATTACH_PATTERN}
            isRef={(t) => (hasIn ? tplTokens.some((x) => x.token === t) : attached.some((x) => x.token === t))}
            roles={roles}
            emptyHint={hasIn ? 'Cette vidéo à refaire n’a pas de fichier à citer.' : 'Joignez des fichiers dans Références : vous pourrez les citer ici.'}
            placeholder={video ? (s.multi ? `Décrivez le plan ${s.active + 1}. Tapez @ pour citer une référence jointe.` : 'Décrivez la scène. Tapez @ pour citer une référence jointe.') : 'Décrivez l’image que vous imaginez.'}
            aria-label={video && s.multi ? `Plan ${s.active + 1}` : 'Description'}
            rows={4}
            data-prompt
          />
        </PromptBox>
      </section>

      <div className="ep-opts auto">
        {video ? (
          <>
            {s.ratios ? (
              <Menu items={s.ratios.map((r) => ({ id: r, title: r === 'auto' ? 'Auto' : r }))} value={s.ratio} onChange={s.setRatio} label="Format" menuWidth={160} className="ep-chip"><Icon name="screen" size={16} />{s.ratio === 'auto' ? 'Auto' : s.ratio}</Menu>
            ) : (
              <button type="button" className="ep-chip" disabled title="Le format suit l’image de départ"><Icon name="screen" size={16} />Auto</button>
            )}
            {s.resolutions && (
              <Menu items={s.resolutions.map((r) => ({ id: r, title: r }))} value={s.res} onChange={s.setRes} label="Résolution" menuWidth={160} className="ep-chip"><Icon name="upscale" size={16} />{s.res}</Menu>
            )}
            {durations.length > 0 && activeTask !== 'edit' && (
              <Menu items={durations} value={s.current.dur} onChange={(d) => s.patch(s.active, { dur: d })} label={s.multi ? `Durée du plan ${s.active + 1}` : 'Durée'} menuWidth={160} className="ep-chip"><Icon name="clock" size={16} />{s.current.dur} s</Menu>
            )}
            {s.soundMode !== 'provided' && (
              <button type="button" className="ep-chip" aria-pressed={s.sound} aria-label="Son" disabled={s.soundMode === 'always'} onClick={() => s.setSound((v) => !v)} title={s.soundMode === 'always' ? 'Ce modèle génère toujours le son' : s.sound ? 'Son activé : cliquer pour le couper' : 'Son coupé : cliquer pour l’activer'}><Icon name={s.sound ? 'sound' : 'mute'} size={16} />{s.sound ? 'ON' : 'OFF'}</button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="ep-chip" onClick={() => setIRatio(nextOf(imodel.caps.ratios, iRatio2))} aria-label={`Format : ${iRatio2}`}><Icon name="screen" size={16} />{iRatio2}</button>
            <button type="button" className="ep-chip" disabled={imodel.caps.resolutions.length < 2} onClick={() => setIRes(nextOf(imodel.caps.resolutions, iRes2))} aria-label={`Résolution : ${iRes2}`}><Icon name="upscale" size={16} />{iRes2}</button>
            <span className="ep-chip ep-step" role="group" aria-label="Nombre d’images">
              <button type="button" onClick={() => setICount((c) => Math.max(1, c - 1))} aria-label="Moins" disabled={iN <= 1}>−</button>
              <b>{iN}/{imodel.caps.maxImages}</b>
              <button type="button" onClick={() => setICount((c) => Math.min(imodel.caps.maxImages, c + 1))} aria-label="Plus" disabled={iN >= imodel.caps.maxImages}>+</button>
            </span>
          </>
        )}
        {features.brand && <BrandToggle />}
      </div>
      {video && s.multi && <p className="tf-hint">{Math.round(s.total * 10) / 10} s au total</p>}

      <GenerateButton price={cost} disabled={blocked} error={error} onClick={generate}
        title={needs ?? (emptyPlan >= 0 ? (s.multi ? `Décrivez le plan ${emptyPlan + 1}` : 'Décrivez d’abord la scène') : (video && !hasIn && caps.startFrame === 'required' && !ref.slots.start ? 'Ajoutez une image dans Références' : undefined))} />
    </div>
  )

  const runBusy = recipe && Boolean(run)
  return (
    <div className="cx-page">
      <SkipLink />
      {/* Pas de barre Plum ici : la barre latérale (Rail) porte le logo, le solde, le thème et le compte. */}
    <div className="cx cn">
      <Rail tab={tab} onTab={openTab} onNew={() => { openTool(null); setView('creations') }} collapsed={railCollapsed} />

      <div className="cx-shell">
      <header className="cx-top">
        <div className="cx-top-l">
          {/* Bouton de repli de la barre latérale, à gauche du projet (absent sur téléphone, où la barre est en haut). */}
          <button type="button" className="cx-fold" aria-expanded={!railCollapsed} aria-label={railCollapsed ? 'Agrandir le menu' : 'Réduire le menu'} title={railCollapsed ? 'Agrandir le menu' : 'Réduire le menu'} onClick={toggleRail}>
            <Icon name="sidebar" size={18} />
          </button>
          <ProjectPicker />
        </div>
      </header>

      <div className="cx-body">
      <ToolPanel tab={tab} onTab={openTab} tool={tool} onTool={openTool} onTemplates={() => setView('templates')} videoTemplates={templates.length}>
      {tool === 'video-gen'   && <CreateLeft key="generate" mode="generate" banner={false} addLabel="Ajouter un média" />}
      {tool === 'modify-video' && <CreateLeft key="edit"    mode="edit"     banner={false} />}
      {tool === 'voice-generator' && <AudioPanel key={tool} tool={tool} onTool={openTool} />}
      {tool && genTpl?.genjutsu.tool === tool
        ? <GenjutsuForm key={genTpl.id} template={genTpl} onClose={() => setGenTpl(null)} onDone={() => setView('creations')} />
        : tool && toolJobs(tool) && <ToolForm key={tool} tool={tool} onDone={() => setView('creations')} />}
      {(tool === 'image' || tool === 'video-refs') && composer}
        {recipe && recipeId && (runBusy
          ? <p className="cx-note">Le modèle « {recipeById(recipeId).name} » est en cours : suivez-le dans Créations.</p>
          : <RecipeForm id={recipeId} texts={rtext} onText={(k, v) => { setRtext((x) => ({ ...x, [k]: v })); setRerror('') }} photos={photos} onPhoto={(k, a) => { setPhotos((x) => ({ ...x, [k]: a ?? undefined })); setRerror('') }} onPick={openTool} error={rerror} onRun={() => { runRecipe(); setView('creations') }} />)}
      </ToolPanel>

      <Showcase
        view={view}
        onView={setView}
        tool={tool}
        onPickTemplate={(id) => { openTool(id); setView('creations') }}
        templates={templates}
        onRecreate={recreate}
        picked={genTpl ?? startTpl}
        onUnpick={() => { setGenTpl(null); setStartTpl(null); setView('templates') }}
        top={runBusy ? <RunStrip jobs={runJobs} onDone={() => setRun(null)} /> : null}
      />
      </div>
      </div>
    </div>

      <AssetModal open={Boolean(picking)} initialSub={picking === 'video' ? 'video' : 'recent'} view={picking === 'styles' ? STYLES_VIEW : null} taken={att.map((x) => x.assetId)} onClose={() => setPicking(null)} onAdd={attach} style={styleId} onStyle={setStyleId} />
    </div>
  )
}
