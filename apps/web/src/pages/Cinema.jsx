import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../lib/icons.jsx'
import { IMAGE_MODELS, VIDEO_MODELS, findModel, imageCost, priceLabel, videoCost } from '@studio/catalog'
import { recipeById, recipeCost } from '@studio/catalog/recipes'
import { findTool, toolCost } from '@studio/catalog/tools'
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
import ToolPanel from '../components/cinema/ToolPanel.jsx'
import Showcase from '../components/cinema/Showcase.jsx'
import { TOOLS, tabOf } from '../components/cinema/tools.js'
import BalanceChip from '../components/BalanceChip.jsx'
import ProjectPicker from '../components/cinema/ProjectPicker.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import { CreateLeft } from './video/CreateTab.jsx'
import AudioPanel from './audio/AudioPanel.jsx'
import ToolForm, { toolJobs } from '../components/cinema/ToolForm.jsx'
import { AccountMenu } from '../lib/auth.jsx'
import { RechargeButton } from '../lib/rechargeDialog.jsx'
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
import { useTemplates } from '../lib/templates.js'
import '../styles/shell.css'
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
  // Image de départ d'une vidéo à refaire (en deux temps, comme chez Krea) : Krea 3 la crée à partir de la photo jointe (ou du texte
  // seul), puis elle remplace la photo dans Références et devient l'image de départ de la vidéo. `start` : { jobId, key, photoId }.
  const [startTpl, setStartTpl] = useState(null) // la vidéo à refaire ouverte, tant que l'outil l'est
  const [imgText, setImgText] = useState('')
  const [start, setStart] = useState(null)
  useEffect(() => {
    if (!tpl || vmodel.id !== tpl.modelId) return
    s.replacePlans((vmodel.caps.multiShot ? tpl.plans : tpl.plans.slice(0, 1)).map((p) => ({ text: p.text, dur: p.dur })))
    if (tpl.resolution && s.resolutions?.includes(tpl.resolution)) s.setRes(tpl.resolution)
    if (tpl.ratio && s.ratios?.includes(tpl.ratio)) s.setRatio(tpl.ratio)
    if (vmodel.caps.audio !== 'always') s.setSound(tpl.sound)
    setStartTpl(tpl); setImgText(tpl.image ?? ''); setStart(null)
    toast(tpl.image ? (tpl.photo ? `« ${tpl.name} » est prêt : ajoutez ${tpl.photo.charAt(0).toLowerCase()}${tpl.photo.slice(1)} dans Références, créez l’image de départ, puis générez.` : `« ${tpl.name} » est prêt : créez l’image de départ, puis générez.`) : tpl.photo ? `« ${tpl.name} » est prêt : ajoutez ${tpl.photo.charAt(0).toLowerCase()}${tpl.photo.slice(1)} dans Références, puis générez.` : `« ${tpl.name} » est prêt : changez le texte si vous voulez, puis générez.`)
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
    if (!id) return setTool(null)
    const t = tabOf(id)
    setTab(t); setTool(id)
    if (t === 'recipe') pickRecipe(id)
  }
  const recreate = (t) => {
    openTool('video-refs'); setTask('refs'); setAtt([]); setStyleId(null); setVideoId(t.modelId); setTpl(t); setView('creations') // la vidéo à refaire a déjà son rendu
  }
  // Changer d'onglet montre la liste de ses outils.
  const openTab = (t) => { setError(''); setTab(t); setTool(null); setStartTpl(null) }
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
  const roles = Object.fromEntries(ref.items.map((i) => [i.token, i.role]))
  const items = attached.map((x) => ({ key: x.id, token: x.token, label: x.token, sub: x.asset.name, asset: x.asset }))
  const native = Boolean(caps.references) // le modèle prolonge ou modifie lui-même une vidéo jointe
  const activeTask = native ? task : 'refs'
  // Suite, Avant et Modifier d'un modèle sans prise en charge native passent par l'écran Vidéo : sans lui, seul « Références » reste (et le menu disparaît).
  const modeItems = native ? MODES.filter((m) => m.id !== 'prev') : features.video ? MODES : MODES.filter((m) => m.id === 'refs')
  const clipSecs = ref.references.filter((r) => r.kind === 'video').reduce((n, r) => n + (r.asset.secs || 0), 0) // durée des vidéos jointes : facturée en entrée
  const secs = activeTask === 'edit' ? Math.max(4, Math.ceil(clipSecs)) : s.total // modifier : la sortie dure autant que la vidéo
  const cost = video ? (native ? videoCost(vmodel, secs, s.res, { inputSecs: clipSecs, sound: s.sound }) : s.cost) : imageCost(imodel, iRes2, iN)

  // Ce qui manque pour lancer, dit en clair sous le texte.
  const needsStart = video && caps.startFrame === 'required' && !ref.slots.start
  const needsClip = video && native && activeTask !== 'refs' && !attached.some((x) => x.asset.kind === 'video')
  const needs = needsClip ? `Joignez une vidéo avec + : elle sera ${activeTask === 'next' ? 'prolongée' : 'modifiée'}.` : needsStart && text.trim() ? 'Ce modèle part d’une image : ajoutez-en une avec +.' : null // l'image est réclamée une fois que l'on a commencé à écrire
  const idle = video && attached.length > 0 && ref.items.every((i) => i.role === 'unused') ? 'Ce modèle n’utilise pas ces références.' : null
  const planHint = video && s.multi && s.plans.findIndex((p) => !p.text.trim()) >= 0 && s.current.text.trim() ? `Décrivez aussi le plan ${s.plans.findIndex((p) => !p.text.trim()) + 1}.` : null
  const emptyPlan = video ? s.plans.findIndex((p) => !p.text.trim()) : (itext.trim() ? -1 : 0) // premier plan sans texte
  const blocked = emptyPlan >= 0 || needsStart || needsClip
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

  // Image de départ (vidéo à refaire) : Krea 3 retouche la photo jointe au format de la vidéo, ou crée l'image du texte seul.
  const TPL_TOOL = findTool('template-image')
  const KREA = findModel(IMAGE_MODELS, 'krea-3')
  const tplPhoto = attached.find((x) => x.asset.kind === 'image')
  const tplRatio = startTpl?.ratio && startTpl.ratio !== 'auto' ? startTpl.ratio : '16:9'
  const startCost = startTpl?.photo
    ? toolCost(TPL_TOOL, { model: 'krea-3', images: ['fichier'], prompt: imgText, ratio: tplRatio })
    : imageCost(KREA, '2K', 1)
  const startJob = start && jobs.find((j) => j.id === start.jobId)
  const startBusy = useRef(false) // envoi en cours (lecture de la photo comprise) : un second clic ne lance pas une seconde image payante
  const makeStart = async () => {
    if (startBusy.current) return
    startBusy.current = true
    try { await sendStart() } finally { startBusy.current = false }
  }
  const sendStart = async () => {
    setError('')
    const prompt = imgText.trim()
    if (!prompt) return setError('Décrivez l’image de départ.')
    let r
    if (startTpl.photo) {
      if (!tplPhoto) return setError(`Ajoutez d’abord ${startTpl.photo.charAt(0).toLowerCase()}${startTpl.photo.slice(1)} dans Références.`)
      let file
      try { file = await getFile(tplPhoto.asset) } catch { return setError('La photo est introuvable : choisissez-la de nouveau.') }
      r = submit({ kind: 'image', title: `${startTpl.name} · image de départ`, prompt, cost: startCost, meta: `Krea 3 · ${tplRatio}`,
        live: { kind: 'tool', modelId: 'template-image', inputs: { model: 'krea-3', prompt, ratio: tplRatio }, inputFiles: { images: [file] } } })
    } else {
      r = submit({ kind: 'image', title: `${startTpl.name} · image de départ`, prompt, cost: startCost, count: 1, meta: `Krea 3 · ${tplRatio}`,
        live: { kind: 'image', modelId: 'krea-3', prompt, resolution: '2K', ratio: tplRatio, count: 1 } })
    }
    if (!r.ok) return setError(`Solde insuffisant : il manque ${jetons(r.missing)} cauris.`)
    setStart({ jobId: r.job.id, key: r.job.key, photoId: tplPhoto?.id ?? null })
  }
  // Image prête : elle prend la place de la photo dans Références (la première image jointe devient l'image de départ).
  const startAsset = start && pool.find((a) => a.id === `${start.key}-0`)
  useEffect(() => {
    if (!startAsset) return
    if (!startTpl) return setStart(null) // vidéo à refaire quittée entre-temps : l'image reste dans Créations, pas dans Références
    setAtt((x) => [{ id: crypto.randomUUID(), assetId: startAsset.id }, ...x.filter((y) => y.id !== start.photoId)])
    setStart(null)
    toast('Image de départ prête : elle est dans Références. Générez la vidéo.')
  }, [startAsset]) // eslint-disable-line react-hooks/exhaustive-deps
  const startFailed = startJob && (startJob.status === 'FAILED' || startJob.status === 'CANCELED')
  useEffect(() => { // échec (remboursé par le serveur) ou annulation : on peut relancer
    if (!startFailed) return
    setStart(null)
    setError(startJob.status === 'FAILED'
      ? 'L’image de départ n’a pas pu être créée (vous avez été remboursé) : réessayez ou changez la consigne.'
      : 'L’image de départ a été annulée : relancez-la quand vous voulez.')
  }, [startFailed]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const onModel = video ? setVideoId : setImageId
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

      {video && modeItems.length > 1 && (
        <Section id="cn-mode" title="Mode">
          <Segmented items={modeItems} value={activeTask} onChange={native ? setTask : fromClip} label="Mode de création" />
        </Section>
      )}

      {video && (
        <Section id="cn-refs" title="Références">
          {attached.length > 0 && (
            <div className="ep-tiles">
              {attached.map((x) => (
                <RefTile key={x.id} asset={x.asset} token={x.token} off={roles[x.token] === 'unused'} onCite={() => area.current?.insertAt(x.token)} onRemove={() => detach(x.id)} />
              ))}
            </div>
          )}
          {startTpl && (
            <div className="ep-from">
              <video src={`${startTpl.video}#t=0.1`} muted loop playsInline preload="metadata" aria-hidden="true" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
              <span><small>D’après la vidéo</small><b>{startTpl.name}</b></span>
              <button type="button" className="ep-x" aria-label={`Ne plus suivre « ${startTpl.name} »`} title="Continuer sans cette vidéo" onClick={() => setStartTpl(null)}><Icon name="close" size={12} /></button>
            </div>
          )}
          {look && <StyleChip style={look} onOpen={() => setPicking('styles')} onClear={() => setStyleId(null)} />}
          <AddMedia label={startTpl?.photo && !tplPhoto ? `Ajouter ${startTpl.photo.charAt(0).toLowerCase()}${startTpl.photo.slice(1)}` : 'Ajouter des références'} onAdd={attach} style={styleId} onStyle={setStyleId} />
        </Section>
      )}

      {!video && <StyleSection id="cn-style" value={styleId} onChange={setStyleId} />}

      {video && startTpl?.image && (
        <Section id="cn-start" title="Image de départ · Krea 3">
          <p className="tf-hint">
            {startTpl.photo
              ? `Krea 3 crée l’image de départ de « ${startTpl.name} » à partir de ${tplPhoto ? 'votre photo' : startTpl.photo.charAt(0).toLowerCase() + startTpl.photo.slice(1) + ' (à ajouter dans Références)'} ; la vidéo l’anime ensuite.`
              : `Krea 3 crée l’image de départ de « ${startTpl.name} » ; la vidéo l’anime ensuite.`}
          </p>
          <PromptBox canClear={Boolean(imgText)} onClear={() => setImgText('')} clearLabel="Effacer l’image de départ"
            enhance={{ value: imgText, onChange: setImgText, ...(startTpl.photo ? { kind: 'edit', modelId: 'krea-3' } : { kind: 'image', modelId: 'krea-3' }) }}>
            <MentionTextarea mentions={false} value={imgText} onChange={(t) => { setImgText(t); setError('') }} aria-label="Image de départ" rows={3} />
          </PromptBox>
          <button type="button" className="ep-chip ep-start" disabled={Boolean(start) || (startTpl.photo && !tplPhoto)} onClick={makeStart}>
            <Icon name="sparkle" size={16} />
            {start ? 'Création de l’image…' : 'Créer l’image de départ'}
            <span className="ep-price">{jetons(startCost)} cauris</span>
          </button>
        </Section>
      )}

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
            pattern={ATTACH_PATTERN}
            isRef={(t) => attached.some((x) => x.token === t)}
            roles={roles}
            emptyHint="Joignez des fichiers dans Références : vous pourrez les citer ici."
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
        title={needs ?? (emptyPlan >= 0 ? (s.multi ? `Décrivez le plan ${emptyPlan + 1}` : 'Décrivez d’abord la scène') : (video && caps.startFrame === 'required' && !ref.slots.start ? 'Ajoutez une image dans Références' : undefined))} />
    </div>
  )

  const runBusy = recipe && Boolean(run)
  return (
    <div className="cx cn">
      <SkipLink />
      <Rail tab={tab} onTab={openTab} onNew={() => { openTool(null); setView('creations') }} />

      <div className="cx-shell">
      <header className="cx-top">
        <ProjectPicker />
        <div className="cx-acc">
          <ThemeToggle className="cx-ib cx-theme" />
          <RechargeButton className="cx-price">Tarifs</RechargeButton>
          <BalanceChip />
          <AccountMenu fallback={<span className="av" aria-hidden="true" />} />
        </div>
      </header>

      <div className="cx-body">
      <ToolPanel tab={tab} onTab={openTab} tool={tool} onTool={openTool} onTemplates={() => setView('templates')} videoTemplates={templates.length}>
      {tool === 'video-gen'   && <CreateLeft key="generate" mode="generate" banner={false} addLabel="Ajouter un média" />}
      {tool === 'modify-video' && <CreateLeft key="edit"    mode="edit"     banner={false} />}
      {tool === 'voice-generator' && <AudioPanel key={tool} tool={tool} onTool={openTool} />}
      {tool && toolJobs(tool) && <ToolForm key={tool} tool={tool} onDone={() => setView('creations')} />}
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
        top={runBusy ? <RunStrip jobs={runJobs} onDone={() => setRun(null)} /> : null}
      />
      </div>
      </div>

      <AssetModal open={Boolean(picking)} initialSub={picking === 'video' ? 'video' : 'recent'} view={picking === 'styles' ? STYLES_VIEW : null} taken={att.map((x) => x.assetId)} onClose={() => setPicking(null)} onAdd={attach} style={styleId} onStyle={setStyleId} />
    </div>
  )
}
