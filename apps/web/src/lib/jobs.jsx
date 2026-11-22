import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { currentProject } from './projects.js'
import { dueJobs } from './pollDelay.js'
import { cancelPatch as cancelReply, createPatch, knownFailure, lostPatch } from './jobReply.js'
import { createLaunchGuard, launchKey } from './launchGuard.js'
import { useAuthState } from './auth.jsx'
import { api, apiEnabled } from './api.js'
import { track } from './posthog.js'

/**
 * Moteur de générations simulé, calqué sur la file d'un fournisseur (fal : IN_QUEUE → IN_PROGRESS → COMPLETED).
 * Remplacez `make` / le minuteur par de vrais appels (soumission, abonnement à la file, webhooks) :
 * les états, le solde et les remboursements restent les mêmes pour l'interface.
 *
 * Mode réel : une génération qui porte `spec.live` (modèle et options) part vers l'API (apps/api), qui appelle fal ;
 * le suivi se fait par interrogation et le solde vient du serveur. Sans `VITE_API_URL`, tout reste simulé.
 *
 * Pour tester les échecs (moteur simulé) : un prompt contenant « [echec] » échoue côté fournisseur ; le mot « nsfw » est refusé
 * par la modération (même règle que l'API, voir apps/api/src/moderation.js). Le reste échoue au hasard (8 %, 15 % en vidéo).
 */
export const MAX_PARALLEL = 2
const START_BALANCE = 240
const cancelPatch = (r) => cancelReply(r, FAILURES)
const BASE_MS = { image: 6000, video: 18000, audio: 5000, montage: 3000 }
const LIVE_MS = { image: 16000, video: 90000, audio: 8000 } // durée typique chez le fournisseur : sert à estimer la progression, fal n'en donne pas

export const jetons = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
// En français, « 1 jeton » mais « 2 jetons » (le singulier couvre aussi 1,5).
export const jetonLabel = (n) => `${jetons(n)} cauri${n >= 2 ? 's' : ''}`

const STEPS = {
  image: [[10, 'Chargement du modèle'], [35, 'Génération'], [80, 'Mise à l’échelle et contrôle qualité'], [95, 'Enregistrement du résultat']],
  video: [[8, 'Chargement du modèle'], [25, 'Génération des images clés'], [60, 'Interpolation du mouvement'], [85, 'Encodage vidéo'], [96, 'Enregistrement du résultat']],
  audio: [[15, 'Synthèse vocale'], [70, 'Normalisation du volume'], [95, 'Enregistrement du résultat']],
  montage: [[20, 'Assemblage de la vidéo'], [50, 'Mixage de la voix'], [75, 'Incrustation des sous-titres'], [92, 'Carte finale et export']],
}

export const FAILURES = {
  moderation: {
    message: 'Contenu refusé par le filtre de sécurité',
    hint: 'Reformulez votre description : évitez les scènes violentes ou explicites. Aucun cauri n’a été débité.',
    retry: false,
  },
  insufficient: {
    message: 'Solde insuffisant',
    hint: 'Il ne reste pas assez de cauris pour cette génération. Rechargez puis relancez : rien n’a été débité.',
    retry: true,
  },
  unreachable: {
    message: 'Le service de génération est injoignable',
    hint: 'Vos cauris n’ont pas été débités. Vérifiez que l’API tourne, puis relancez.',
    retry: true,
  },
  auth: {
    message: 'Connexion expirée',
    hint: 'Reconnectez-vous, puis relancez. Rien n’a été débité.',
    retry: true,
  },
  busy: {
    message: 'Trop de générations en cours',
    hint: 'Attendez qu’une génération se termine, puis relancez. Rien n’a été débité.',
    retry: true,
  },
  too_expensive: {
    message: 'Génération trop coûteuse',
    hint: 'Cette demande dépasse la limite d’une génération. Réduisez la durée ou la résolution, puis relancez : rien n’a été débité.',
    retry: false,
  },
  rejected: {
    message: 'La demande a été refusée par le service',
    hint: 'Vérifiez le modèle et les options choisis, puis relancez. Aucun cauri n’a été débité.',
    retry: false,
  },
  media: {
    message: 'Fichier refusé',
    hint: 'Ce fichier est trop long ou trop court pour cet outil, de trop haute résolution, ou dans un format que le service ne sait pas mesurer (préférez MP4, MP3 ou WAV). Aucun cauri n’a été débité.',
    retry: false,
  },
  duration: {
    message: 'Durée refusée',
    hint: 'La durée demandée, ou celle de votre fichier audio, n’est pas acceptée par ce modèle. Changez la durée ou le fichier, puis relancez. Aucun cauri n’a été débité.',
    retry: false,
  },
  blocked: {
    message: 'Votre compte est suspendu. Contactez le support.',
    hint: 'Les nouvelles générations sont bloquées sur ce compte. Rien n’a été débité.',
    retry: false,
  },
  provider: {
    message: 'Le fournisseur n’a pas répondu à temps',
    hint: 'Ce n’est pas lié à votre demande. Vos cauris ont été remboursés : vous pouvez relancer.',
    retry: true,
  },
  lost: {
    message: 'Génération introuvable',
    hint: 'Le service n’a pas gardé trace de cette génération. Vérifiez votre solde et votre historique avant de relancer.',
    retry: true,
  },
}

function tick(state, now) {
  let balance = state.balance
  const notes = []

  let jobs = state.jobs.map((j) => {
    if (j.live) return j.status === 'IN_PROGRESS' ? { ...j, progress: Math.min(92, ((now - j.startedAt) / j.duration) * 100) } : j // estimation : fal ne donne pas de pourcentage
    if (j.status !== 'IN_PROGRESS') return j
    const progress = Math.min(100, ((now - j.startedAt) / j.duration) * 100)
    const fresh = j.steps.filter(([p, msg]) => p <= progress && !j.logs.some((l) => l.msg === msg)).map(([, msg]) => ({ msg }))
    const logs = fresh.length ? j.logs.concat(fresh) : j.logs
    if (j.failure && progress >= j.failAt) {
      balance += j.cost
      notes.push(`Échec : ${j.title}. ${jetons(j.cost)} cauris remboursés.`)
      return { ...j, status: 'FAILED', progress: j.failAt, finishedAt: now, refund: j.cost, logs: logs.concat({ msg: `Erreur : ${FAILURES[j.failure].message}`, error: true }) }
    }
    if (progress >= 100) {
      notes.push(`Terminée : ${j.title}.`)
      return { ...j, status: 'COMPLETED', progress: 100, finishedAt: now, logs: logs.concat({ msg: 'Terminé' }) }
    }
    return { ...j, progress, logs }
  })

  let running = jobs.filter((j) => !j.live && j.status === 'IN_PROGRESS').length
  jobs = jobs.map((j) => {
    if (j.live || j.status !== 'IN_QUEUE' || running >= MAX_PARALLEL) return j
    running++
    return { ...j, status: 'IN_PROGRESS', startedAt: now, progress: 0, queuePosition: 0, logs: j.logs.concat({ msg: 'Démarrage du worker' }) }
  })

  // Position et attente estimée de chaque job en file : chacun prend le premier créneau libre.
  const slots = jobs.filter((j) => !j.live && j.status === 'IN_PROGRESS').map((j) => Math.max(0, j.startedAt + j.duration - now))
  while (slots.length < MAX_PARALLEL) slots.push(0)
  let position = 0
  jobs = jobs.map((j) => {
    if (j.live || j.status !== 'IN_QUEUE') return j
    position++
    slots.sort((a, b) => a - b)
    const eta = slots[0]
    slots[0] += j.duration
    return { ...j, queuePosition: position, eta }
  })

  return { ...state, jobs, balance, message: notes.length ? notes.join(' ') : state.message }
}

function reducer(state, action) {
  switch (action.type) {
    case 'TICK':
      return tick(state, action.now)
    case 'SUBMIT':
      return tick({ ...state, balance: action.job.live ? state.balance : state.balance - action.job.cost, jobs: [...state.jobs, action.job], message: `${action.job.title} : en file d’attente.` }, action.now)
    case 'RETRY': {
      const jobs = state.jobs.filter((j) => j.id !== action.replaces).concat(action.job)
      return tick({ ...state, balance: action.job.live ? state.balance : state.balance - action.job.cost, jobs, message: `${action.job.title} : nouvelle tentative.` }, action.now)
    }
    case 'CANCEL': {
      const j = state.jobs.find((x) => x.id === action.id)
      if (!j || (j.status !== 'IN_QUEUE' && j.status !== 'IN_PROGRESS')) return state
      if (j.live) {
        // Réel : annulée en file = remboursée en entier ; déjà en cours chez le fournisseur = facturée. C'est le serveur qui le dit :
        // tant qu'il n'a pas répondu (`cancelPending`), la carte n'annonce ni remboursement ni facturation (voir `sendCancel`).
        const jobs = state.jobs.map((x) => (x.id === j.id ? { ...x, status: 'CANCELED', finishedAt: action.now, refund: 0, cancelPending: true, canceledBy: 'user', canceledFrom: j.status, logs: x.logs.concat({ msg: 'Annulé par l’utilisateur' }) } : x))
        return { ...state, jobs, message: `${j.title} : arrêt demandé.` }
      }
      // En file : tout est remboursé. En cours : seule la part non consommée l'est.
      const refund = j.status === 'IN_QUEUE' ? j.cost : Math.round(j.cost * (1 - j.progress / 100) * 10) / 10
      const jobs = state.jobs.map((x) => (x.id === j.id ? { ...x, status: 'CANCELED', finishedAt: action.now, refund, logs: x.logs.concat({ msg: 'Annulé par l’utilisateur' }) } : x))
      return tick({ ...state, jobs, balance: state.balance + refund, message: `${j.title} annulée. ${jetons(refund)} cauris remboursés.` }, action.now)
    }
    case 'SYNC_WALLET':
      return { ...state, balance: action.balance, serverBalance: action.balance }
    case 'REMOTE': {
      // Résultat d'un appel à l'API : on met la génération à jour, et le solde du serveur n'ajoute que sa variation
      // (les dépenses du moteur simulé, que le serveur ignore, restent comptées).
      let { balance, serverBalance } = state
      if (action.balance != null) {
        if (serverBalance != null) balance += action.balance - serverBalance
        serverBalance = action.balance
      }
      const jobs = state.jobs.map((j) => (j.id === action.id ? { ...j, ...action.patch, logs: action.patch.logs ? j.logs.concat(action.patch.logs) : j.logs } : j))
      return { ...state, jobs, balance, serverBalance, message: action.message ?? state.message }
    }
    case 'DISMISS':
      return { ...state, jobs: state.jobs.filter((j) => j.id !== action.id) }
    case 'CLEAR_DONE':
      return { ...state, jobs: state.jobs.filter((j) => (action.kind ? j.kind !== action.kind : false) || j.status === 'IN_QUEUE' || j.status === 'IN_PROGRESS') }
    default:
      return state
  }
}

const Ctx = createContext(null)
export const useJobs = () => useContext(Ctx)

export function JobsProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { jobs: [], balance: START_BALANCE, serverBalance: null, message: '' })
  const ref = useRef(state)
  ref.current = state
  const seq = useRef(0)
  const analytics = useRef(new Map()) // propriétés de mesure de chaque génération lancée ici (type, outil, prix), pour les événements de fin
  const guard = useRef(null) // lancements récents : une demande identique répétée (double appui) n'est pas lancée deux fois
  if (!guard.current) guard.current = createLaunchGuard()
  const sent = useRef(null) // envoi au service du dernier lancement (promesse : `false` s'il a été refusé), pour le bouton (lib/useLaunch.js)

  const active = state.jobs.some((j) => j.status === 'IN_QUEUE' || j.status === 'IN_PROGRESS')
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => dispatch({ type: 'TICK', now: Date.now() }), 250)
    return () => clearInterval(id)
  }, [active])

  const make = useCallback((raw, attempt = 1) => {
    const spec = raw.project ? raw : { ...raw, project: currentProject() } // la génération reste dans le projet où elle a été lancée
    const kind = spec.kind
    const count = spec.count ?? 1
    const moderated = /nsfw/i.test([spec.prompt, spec.styleHint, spec.brandStyle].map((v) => String(v ?? '')).join('\n').normalize('NFKC').replace(/\p{Cf}/gu, ''))
    const live = Boolean(spec.live && apiEnabled)
    const failure = live ? null : moderated ? 'moderation' : /\[echec\]/i.test(spec.prompt) || Math.random() < (kind === 'video' ? 0.15 : 0.08) ? 'provider' : null
    const id = `job-${++seq.current}`
    const createdAt = Date.now()
    return {
      id,
      key: `${createdAt}-${id}`, // identifiant stable entre sessions : sert d'origine aux assets créés
      kind,
      title: spec.title,
      prompt: spec.prompt,
      meta: spec.meta,
      count,
      cost: spec.cost,
      spec,
      attempt,
      status: 'IN_QUEUE',
      createdAt,
      startedAt: null,
      finishedAt: null,
      progress: 0,
      queuePosition: 0,
      eta: 0,
      live,
      remoteId: null,
      duration: live ? LIVE_MS[kind] : BASE_MS[kind] * (0.8 + Math.random() * 0.4),
      failure,
      failAt: moderated ? 4 : 35 + Math.random() * 45,
      steps: STEPS[kind],
      logs: [{ msg: live ? 'Envoyé au service de génération' : 'Requête reçue, en file d’attente' }],
      refund: 0,
      seeds: Array.from({ length: count }, () => Math.floor(Math.random() * 1000)),
    }
  }, [])

  // Échec d'un appel à l'API (avant ou pendant l'envoi à fal) : la génération échoue, avec le remboursement que le serveur confirme.
  const failLive = useCallback((id, err) => {
    const code = err.body?.error
    const failure = ['unmeasured_media', 'media_too_long', 'media_too_short', 'media_too_large'].includes(code) ? 'media' : code === 'invalid_duration' ? 'duration' : code === 'account_blocked' ? 'blocked' : code === 'moderation' ? 'moderation' : code === 'insufficient' ? 'insufficient' : code === 'too_expensive' ? 'too_expensive' : code === 'too_many_active' ? 'busy' : err.status === 401 || code === 'unauthorized' ? 'auth' : err.status === 0 ? 'unreachable' : err.status === 400 ? 'rejected' : 'provider'
    const job = ref.current.jobs.find((j) => j.id === id)
    dispatch({
      type: 'REMOTE', id, balance: err.body?.balance,
      patch: { status: 'FAILED', failure, refund: err.body?.refunded ?? 0, finishedAt: Date.now(), logs: [{ msg: `Erreur : ${FAILURES[failure].message}`, error: true }] },
      message: `Échec : ${job?.title ?? 'génération'}.`,
    })
    track('generation_failed', { ...analytics.current.get(id), failure, stage: 'submit' })
  }, [])

  // Envoi réel : les fichiers d'entrée (images, audio) sont d'abord déposés chez le fournisseur, puis la demande part.
  const startLive = useCallback(async (job, live) => {
    const { files, elements, references, inputFiles, templateInputs, ...body } = live
    const given = Object.entries(files ?? {}).filter(([, f]) => f)
    const total = given.length + (elements?.length ?? 0) + (references?.length ?? 0) + (templateInputs?.length ?? 0)
    if (total) {
      dispatch({ type: 'REMOTE', id: job.id, patch: { logs: [{ msg: total > 1 ? 'Envoi des fichiers' : 'Envoi du fichier' }] } })
      const [urls, elUrls, refUrls, tplUrls] = await Promise.all([Promise.all(given.map(([, f]) => api.upload(f))), Promise.all((elements ?? []).map((e) => api.upload(e.file))), Promise.all((references ?? []).map((r) => api.upload(r.file))), Promise.all((templateInputs ?? []).map((t) => api.upload(t.file)))])
      // Vidéo à refaire : chaque entrée garde son numéro ; le serveur place les fichiers selon le modèle et ajoute ceux de Qreativ.
      if (templateInputs?.length) body.templateInputs = templateInputs.map((t, i) => ({ idx: t.idx, url: tplUrls[i] }))
      const field = { start: 'startImageUrl', end: 'endImageUrl', audio: 'audioUrl', model: 'modelImageUrl', garment: 'garmentImageUrl' }
      given.forEach(([slot], i) => { body[field[slot]] = urls[i] })
      if (elements?.length) body.elements = elements.map((e, i) => ({ kind: e.kind, url: elUrls[i] }))
      if (references?.length) body.references = references.map((r, i) => ({ kind: r.kind, url: refUrls[i] }))
    }
    if (templateInputs && !body.templateInputs) body.templateInputs = [] // rien à fournir : seulement les fichiers de Qreativ
    if (inputFiles) { // workflow : chaque champ photo (un fichier, ou une liste) est déposé chez le fournisseur
      const up = async (v) => (Array.isArray(v) ? Promise.all(v.map((f) => api.upload(f))) : api.upload(v))
      const entries = await Promise.all(Object.entries(inputFiles).map(async ([k, v]) => [k, await up(v)]))
      body.inputs = { ...body.inputs, ...Object.fromEntries(entries) }
    }
    body.requestId = job.key // même clé = même génération côté serveur : un nouvel essai ne débite pas deux fois
    try {
      return await api.createJob(body)
    } catch (e) {
      if (e.status !== 0 && e.status < 500) throw e // refus clair (solde, modération…) : inutile de réessayer
      await new Promise((r) => setTimeout(r, 1000)) // coupure réseau ou erreur passagère : un seul nouvel essai, sans risque grâce à la clé
      return api.createJob(body)
    }
  }, [])

  // Arrêt d'une génération réelle : la carte n'annonce un remboursement (ou son absence) qu'avec la réponse du serveur. Sans réponse
  // (panne, coupure), rien n'a été arrêté ni rendu : la génération reprend son état et son suivi. Rend `false` si elle continue.
  const sendCancel = useCallback((id, remoteId) => api.cancelJob(remoteId)
    .then((r) => {
      const j = ref.current.jobs.find((x) => x.id === id)
      const stopped = !r?.status || r.status === 'CANCELED'
      const goesOn = r?.status === 'IN_QUEUE' || r?.status === 'IN_PROGRESS' // le serveur ne l'a pas arrêtée (ses fichiers s'enregistrent)
      const patch = { ...cancelPatch(r), cancelPending: false }
      if (goesOn) { patch.canceledBy = undefined; patch.logs = [{ msg: 'Arrêt impossible : la génération continue' }] }
      dispatch({ type: 'REMOTE', id, balance: r.balance, patch, message: !j ? undefined : goesOn ? `L’arrêt n’a pas abouti : ${j.title} continue.` : !stopped ? undefined : r.refund > 0 ? `${j.title} annulée. ${jetons(r.refund)} cauris remboursés.` : `${j.title} annulée, sans remboursement.` })
      return !goesOn
    })
    .catch(() => {
      const j = ref.current.jobs.find((x) => x.id === id)
      if (j?.status === 'CANCELED' && j.cancelPending) dispatch({ type: 'REMOTE', id, patch: { status: j.canceledFrom, finishedAt: null, cancelPending: false, canceledBy: undefined, logs: [{ msg: 'Arrêt impossible : la génération continue' }] }, message: `L’arrêt n’a pas abouti : ${j.title} continue.` })
      return false
    }), [])

  const submit = useCallback((spec, replaces) => {
    // Même demande déjà en cours d'envoi, ou lancée à l'instant : on rend la première sans rien lancer ni débiter. Vérifié avant le
    // solde, que la première vient d'entamer. Une première déjà échouée ou annulée ne retient rien : on peut relancer.
    const key = launchKey(spec, replaces)
    const first = guard.current.find(key, Date.now())
    if (first) {
      const j = ref.current.jobs.find((x) => x.id === first.job.id)
      if (!j || (j.status !== 'FAILED' && j.status !== 'CANCELED')) { sent.current = first.sent; return first }
      guard.current.drop(key, first)
    }
    const missing = spec.cost - ref.current.balance
    if (missing > 0) return { ok: false, missing }
    const attempt = replaces ? (ref.current.jobs.find((j) => j.id === replaces)?.attempt ?? 1) + 1 : 1
    const job = make(spec, attempt)
    dispatch(replaces ? { type: 'RETRY', replaces, job, now: Date.now() } : { type: 'SUBMIT', job, now: Date.now() })
    // Mesure d'audience : le type, l'outil et le prix, jamais la consigne.
    const props = {
      kind: spec.kind, // image, video, audio
      model: spec.live?.modelId ?? spec.modelId ?? null, // modèle, outil (upscale, motion-transfer…) ou modèle de vidéo (workflow)
      mode: spec.live?.kind ?? null, // image, video, audio, tool, workflow
      template: spec.live?.template ?? null,
      style: spec.live?.style ?? spec.live?.inputs?.style ?? null, // style « By Qreativ »
      brand_style: Boolean(spec.brandStyle), // style de la marque appliqué
      chain: Boolean(spec.chain), recipe: Boolean(spec.recipe),
      cost: spec.cost, count: spec.count ?? 1, live: Boolean(job.live),
    }
    analytics.current.set(job.id, props)
    track('generation_submitted', { ...props, retry: Boolean(replaces) })
    // `sent` : l'envoi au service ; rend `false` s'il est refusé (solde, modération, panne), `true` sinon. Le moteur simulé n'envoie rien.
    const result = { ok: true, job, sent: Promise.resolve(true) }
    guard.current.record(key, result, Date.now(), job.live)
    if (job.live) {
      result.sent = startLive(job, spec.live)
        .then((r) => {
          guard.current.settle(key, result, Date.now())
          // Le serveur peut rendre une génération déjà enregistrée (nouvel essai, même clé) : échouée et remboursée, elle s'arrête ici.
          const patch = createPatch(r, FAILURES, Date.now(), ref.current.jobs.find((j) => j.id === job.id)?.status === 'IN_QUEUE')
          if (patch.status === 'FAILED') {
            dispatch({ type: 'REMOTE', id: job.id, balance: r.balance, patch: { ...patch, logs: [{ msg: `Erreur : ${FAILURES[patch.failure].message}`, error: true }] }, message: `Échec : ${job.title}.${patch.refund ? ` ${jetons(patch.refund)} cauris remboursés.` : ''}` })
            track('generation_failed', { ...analytics.current.get(job.id), failure: patch.failure, stage: 'submit', refund: patch.refund })
            return false
          }
          dispatch({ type: 'REMOTE', id: job.id, balance: r.balance, patch: { ...patch, logs: [{ msg: 'Demande acceptée' }] } })
          // Annulée pendant l'envoi : on prévient le serveur dès qu'il a un identifiant.
          if (ref.current.jobs.find((j) => j.id === job.id)?.status === 'CANCELED') sendCancel(job.id, r.jobId)
          return true
        })
        .catch((e) => { guard.current.drop(key, result); failLive(job.id, e); return false })
    }
    sent.current = result.sent
    return result
  }, [make, failLive, startLive, sendCancel])

  // Solde réel au démarrage (et à la connexion : sans session, l'API refuse).
  const { ready, signedIn } = useAuthState()
  useEffect(() => {
    if (!apiEnabled || !ready || !signedIn) return
    api.wallet().then((w) => dispatch({ type: 'SYNC_WALLET', balance: w.balance })).catch(() => { /* API éteinte : le solde simulé reste affiché */ })
  }, [ready, signedIn])

  // Suivi des générations réelles : on interroge l'API tant qu'une génération est active.
  const polling = useRef(new Set())
  const last = useRef(new Map()) // dernier appel par génération : le rythme dépend de son âge et de la visibilité de l'onglet
  const misses = useRef(new Map()) // réponses 404 de suite par génération : { n, since } (voir lostPatch)
  const liveActive = state.jobs.some((j) => j.live && j.remoteId && (j.status === 'IN_QUEUE' || j.status === 'IN_PROGRESS'))
  useEffect(() => {
    if (!liveActive) return
    const isActive = (j) => j && (j.status === 'IN_QUEUE' || j.status === 'IN_PROGRESS')
    const poll = () => dueJobs(ref.current.jobs.filter((j) => j.live && j.remoteId && isActive(j)), last.current, Date.now(), document.hidden).forEach(async (j) => {
      if (polling.current.has(j.id)) return
      polling.current.add(j.id)
      last.current.set(j.id, Date.now())
      try {
        const r = await api.job(j.remoteId)
        misses.current.delete(j.id)
        if (!isActive(ref.current.jobs.find((x) => x.id === j.id))) return // annulée entre-temps : on ne la relance pas
        const now = Date.now()
        const logs = (r.logs ?? []).filter((m) => !j.logs.some((l) => l.msg === m)).map((msg) => ({ msg }))
        let patch
        let message
        if (r.status === 'COMPLETED') { patch = { status: 'COMPLETED', progress: 100, finishedAt: now, outputs: r.outputs, logs: logs.concat({ msg: 'Terminé' }) }; message = `Terminée : ${j.title}.`; track('generation_completed', { kind: j.kind, ...analytics.current.get(j.id), seconds: Math.round((now - j.createdAt) / 1000) }) }
        else if (r.status === 'FAILED') { const failure = knownFailure(r.failure, FAILURES); track('generation_failed', { kind: j.kind, ...analytics.current.get(j.id), failure, stage: 'provider', refund: r.refund ?? 0 }); patch = { status: 'FAILED', failure, refund: r.refund ?? 0, finishedAt: now, logs: logs.concat({ msg: `Erreur : ${FAILURES[failure].message}`, error: true }) }; message = `Échec : ${j.title}. ${jetons(r.refund ?? 0)} cauris remboursés.` }
        else if (r.status === 'IN_PROGRESS') patch = { status: 'IN_PROGRESS', startedAt: j.startedAt ?? now, queuePosition: 0, logs: logs.length || j.logs.some((l) => l.msg === 'Génération en cours') ? logs : [{ msg: 'Génération en cours' }] } // fal ne détaille pas toujours ses étapes
        // Annulée côté serveur (par le support) : remboursement affiché ; `failure` (« admin_cancel ») n'est pas repris, ce n'est pas un échec.
        else if (r.status === 'CANCELED') { patch = { status: 'CANCELED', refund: r.refund ?? 0, finishedAt: now, logs: logs.concat({ msg: 'Annulée par le support' }) }; message = `Annulée par le support : ${j.title}.${r.refund ? ` ${jetons(r.refund)} cauris remboursés.` : ''}` }
        else patch = { status: 'IN_QUEUE', queuePosition: r.queuePosition ?? 0, logs }
        dispatch({ type: 'REMOTE', id: j.id, balance: r.balance, patch, message })
      } catch (e) {
        // Le reste est passager : on réessaie au prochain tour. Introuvable plusieurs fois de suite : la génération est perdue, le suivi s'arrête.
        if (e?.status !== 404) return
        const seen = misses.current.get(j.id) ?? { n: 0, since: Date.now() }
        seen.n++
        misses.current.set(j.id, seen)
        const patch = lostPatch(seen.n, seen.since, Date.now())
        if (!patch || !isActive(ref.current.jobs.find((x) => x.id === j.id))) return
        misses.current.delete(j.id)
        dispatch({ type: 'REMOTE', id: j.id, patch: { ...patch, logs: [{ msg: `Erreur : ${FAILURES.lost.message}`, error: true }] }, message: `Échec : ${j.title}.` })
        track('generation_failed', { kind: j.kind, ...analytics.current.get(j.id), failure: 'lost', stage: 'provider', refund: 0 })
      } finally { polling.current.delete(j.id) }
    })
    poll()
    const id = setInterval(poll, 1000) // simple vérification locale : seules les générations dont le délai est écoulé appellent l'API
    const wake = () => { if (!document.hidden) { last.current.clear(); poll() } } // retour sur l'onglet : on se met à jour tout de suite
    document.addEventListener('visibilitychange', wake)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', wake) }
  }, [liveActive])

  const cancel = useCallback((id) => {
    const j = ref.current.jobs.find((x) => x.id === id)
    dispatch({ type: 'CANCEL', id, now: Date.now() })
    // Encore en cours d'envoi (pas d'identifiant) : `submit` prévient le serveur dès qu'il en a un.
    return j?.live && j.remoteId ? sendCancel(id, j.remoteId) : Promise.resolve(true)
  }, [sendCancel])

  const value = useMemo(() => ({
    jobs: state.jobs,
    balance: state.balance,
    running: state.jobs.filter((j) => j.status === 'IN_PROGRESS').length,
    queued: state.jobs.filter((j) => j.status === 'IN_QUEUE').length,
    submit,
    retry: (job) => submit(job.spec, job.id),
    rerun: (job) => submit(job.spec),
    cancel,
    lastSent: () => sent.current,
    dismiss: (id) => dispatch({ type: 'DISMISS', id }),
    clearDone: (kind) => dispatch({ type: 'CLEAR_DONE', kind }),
    syncBalance: (balance) => { if (typeof balance === 'number') dispatch({ type: 'SYNC_WALLET', balance }) }, // solde réel rendu par l'API (recharges)
  }), [state.jobs, state.balance, submit, cancel])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite">{state.message}</div>
    </Ctx.Provider>
  )
}
