import { STORING, advanceJob, isActive } from './jobs.js'
import { assetItems, jobItem, ledgerItem, topupItem, walletHistory, write } from './mirror.js'
import { applyPayment, isOpen } from './topups.js'
import { credit, debit, emptyWallet, refund } from './wallet.js'

const DEV_SEED = 240 // jetons offerts à un compte neuf, en développement seulement
const TOPUP_INDEX = 200 // recharges gardées dans l'historique du compte
const OPEN_WINDOW = 20 * 60_000 // une recharge ouverte depuis plus longtemps ne compte plus dans la limite
const OUTBOX_WARN = 5000 // au-delà, D1 est en panne depuis longtemps : on le signale (rien n'est jeté)
const ACCOUNT_ID = /^[\w-]{3,100}$/
const WAKE_EVERY = 60_000 // tant qu'une génération est active, le compte se réveille pour la faire avancer (voir alarm)
const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELED'] // statuts définitifs d'une génération
const BLOCKED = { ok: false, error: 'account_blocked' }

/**
 * Durable Object : un compte = un portefeuille + ses générations + ses recharges. Les requêtes d'un même compte passent l'une
 * après l'autre, donc un débit et son remboursement ne peuvent pas se croiser.
 *
 * Chaque mouvement de jetons et chaque recharge est aussi copié dans D1 (voir mirror.js) : d'abord dans une file (`outbox`) gardée ici,
 * puis écrit dans D1. Si D1 ne répond pas, la file attend la requête suivante ; la réponse au client n'en dépend jamais.
 * Le Durable Object ne connaît pas son propre nom : le Worker l'envoie dans l'en-tête `x-account`.
 *
 * Tant qu'une génération est active, une alarme réveille le compte toutes les minutes pour la faire avancer (voir jobs.js) :
 * elle se termine, est copiée dans R2 ou remboursée même si personne n'interroge l'API (page fermée, webhook perdu, Runware).
 */
export class Account {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.accountId = null
    this.flushing = null
  }

  /** Met des éléments dans la file vers D1, puis tente de la vider (en tâche de fond quand le runtime le permet). */
  async record(...items) {
    if (!this.env.DB) return
    const outbox = (await this.state.storage.get('outbox')) ?? []
    outbox.push(...items)
    await this.state.storage.put('outbox', outbox)
    const p = this.flush()
    if (this.state.waitUntil) this.state.waitUntil(p)
    else await p
  }

  /** À chaque requête : s'il reste des éléments en file (D1 était en panne) ou si l'historique n'est pas encore copié, on réessaie. */
  async retry() {
    if (!this.env.DB || this.flushing || !this.accountId) return
    const pending = ((await this.state.storage.get('outbox')) ?? []).length > 0 || !(await this.state.storage.get('mirrored'))
    if (!pending) return
    const p = this.flush()
    if (this.state.waitUntil) this.state.waitUntil(p)
    else await p
  }

  /** Écrit la file dans D1, dans l'ordre ; s'arrête à la première erreur. Une seule à la fois ; reprend l'historique au premier passage. */
  flush() {
    this.flushing ??= this.drain().catch((e) => console.error('copie D1', e.message)).finally(() => { this.flushing = null })
    return this.flushing
  }

  async drain() {
    const storage = this.state.storage
    const account = this.accountId ?? (this.accountId = (await storage.get('account')) ?? null)
    if (!account || !this.env.DB) return
    if (!(await storage.get('mirrored'))) {
      // Premier passage : tout ce qui existait avant D1 (lignes sans solde), après la file : une ligne déjà en file (avec son solde)
      // passe la première, la même ligne reprise de l'historique est alors ignorée. Rejoué, cela ne change rien.
      const w = await storage.get('wallet')
      const refs = (await storage.get('topups')) ?? []
      const topups = (await Promise.all(refs.map((r) => storage.get(`topup:${r}`)))).filter(Boolean)
      const outbox = (await storage.get('outbox')) ?? []
      await storage.put('outbox', [...outbox, ...(w ? walletHistory(w) : []), ...topups.map(topupItem)])
      await storage.put('mirrored', true)
    }
    // Jusqu'à ce que la file soit vide : d'autres requêtes peuvent y ajouter des éléments pendant qu'on écrit.
    for (let items; (items = (await storage.get('outbox')) ?? []).length;) {
      if (items.length > OUTBOX_WARN) console.error('copie D1 : file de', items.length, 'éléments pour', account)
      let done = 0
      try {
        for (const item of items) { await write(this.env.DB, account, item); done++ }
      } finally {
        // On retire seulement les éléments écrits, au début de la file : ceux ajoutés entre-temps restent.
        if (done) await storage.put('outbox', ((await storage.get('outbox')) ?? []).slice(done))
      }
    }
  }

  async wallet() {
    let w = await this.state.storage.get('wallet')
    if (!w) {
      w = emptyWallet()
      if (this.env.ENV === 'dev') credit(w, { paymentId: 'dev-seed', amount: DEV_SEED })
      await this.state.storage.put('wallet', w)
      if (w.balance && (await this.state.storage.get('mirrored'))) await this.record(ledgerItem('credit', 'dev-seed', DEV_SEED, w.balance))
    }
    return w
  }

  /** Tient la liste des générations actives du compte ; une réservation oubliée depuis plus de 3 h est considérée comme perdue. */
  async track(jobId, active) {
    const now = Date.now()
    const map = (await this.state.storage.get('active')) ?? {}
    for (const [id, at] of Object.entries(map)) if (now - at > 3 * 3600_000) delete map[id]
    if (active) map[jobId] = map[jobId] ?? now
    else if (jobId) delete map[jobId]
    await this.state.storage.put('active', map)
    return Object.keys(map)
  }

  /** Programme le prochain réveil, s'il n'y en a pas déjà un (le runtime de test n'a pas d'alarmes). */
  async wake() {
    const storage = this.state.storage
    if (!storage.setAlarm || (await storage.getAlarm())) return
    await storage.setAlarm(Date.now() + WAKE_EVERY)
  }

  /** Réveil : fait avancer chaque génération active, puis se reprogramme tant qu'il en reste. */
  async alarm() {
    const account = this.accountId ?? (this.accountId = (await this.state.storage.get('account')) ?? null)
    const acct = async (path, body) => (await this.fetch(new Request(`https://account${path}`, { method: 'POST', body: JSON.stringify(body) }))).json()
    for (const id of await this.track(null, false)) {
      const job = await this.state.storage.get(`job:${id}`)
      // Réservée mais pas encore envoyée, ou d'avant ce réveil (sans `origin` pour ses adresses /files) : l'interface s'en charge.
      if (!account || !job || !isActive(job) || (!job.origin && this.env.FILES)) continue
      try {
        await advanceJob({ env: this.env, acct, accountId: account, origin: job.origin, job })
      } catch (e) {
        console.error('réveil du compte', job.provider ?? 'fal', e.message) // erreur passagère : au prochain réveil
      }
    }
    if ((await this.track(null, false)).length) await this.wake()
  }

  async fetch(request) {
    const url = new URL(request.url)
    const { pathname } = url
    const who = request.headers.get('x-account')
    if (who && who !== this.accountId && ACCOUNT_ID.test(who)) {
      this.accountId = who
      if ((await this.state.storage.get('account')) !== who) await this.state.storage.put('account', who)
    }
    await this.retry()

    // Compte bloqué par un administrateur : `blocked` = { at, actor, reason } ou null (jamais effacé : le stockage de test n'a que get et put).
    // Bloqué, il ne peut plus lancer de génération ni ouvrir de recharge ; ses générations en cours, ses webhooks et ses remboursements continuent.
    const blocked = async () => (await this.state.storage.get('blocked')) ?? null
    if (pathname === '/blocked') return Response.json({ blocked: await blocked() })
    // Lecture pour l'administration : sans créer de portefeuille (ni crédit de développement) pour un compte qui n'en a pas.
    if (pathname === '/admin/state') return Response.json({ balance: (await this.state.storage.get('wallet'))?.balance ?? 0, blocked: await blocked() })
    // Résultat d'une action de l'administration gardé sous `adm:<clé>` (voir /admin/adjust) : D1 peut ne pas l'avoir noté.
    // `/admin/kept` le lit, ou le garde s'il est donné (`entry`) et que la clé est encore libre ; rend ce qui est gardé ou null.
    const kept = (key) => (key ? this.state.storage.get(`adm:${key}`) : null)
    const keep = (key, entry) => (key ? this.state.storage.put(`adm:${key}`, { ...entry, at: Date.now() }) : null)
    if (pathname === '/admin/kept') {
      const { key, entry } = await request.json()
      const prev = (await kept(key)) ?? null
      if (!prev && entry) await keep(key, entry)
      return Response.json(prev)
    }
    if (pathname === '/admin/block') {
      const { blocked: on, reason, actor, key } = await request.json()
      const action = on ? 'block' : 'unblock'
      const prev = await kept(key)
      if (prev) return prev.action === action ? Response.json({ ...prev.result, replayed: true }) : Response.json({ ok: false, error: 'key_conflict' }, { status: 409 })
      const next = on ? { at: Date.now(), actor, reason } : null
      await this.state.storage.put('blocked', next)
      await keep(key, { action, result: { ok: true, blocked: next } })
      return Response.json({ ok: true, blocked: next })
    }

    if (pathname === '/job/get') return Response.json((await this.state.storage.get(`job:${url.searchParams.get('id')}`)) ?? null)
    if (pathname === '/job/put') {
      const job = await request.json()
      // Un statut définitif ne change plus : un webhook ou un réveil en retard n'écrase pas une annulation (ni l'inverse) ;
      // le refus rend la génération enregistrée, pour que l'appelant réponde avec elle. Remettre le même statut reste permis
      // (sortie enregistrée), mais sans perdre ce que l'administration ou un remboursement y a noté (copie faite d'un état plus ancien).
      const prev = await this.state.storage.get(`job:${job.id}`)
      // Prise de la copie dans R2 (`storingAt` avec son jeton `storingBy`) : un seul suivi à la fois. Deux suivis partis de la même
      // copie de la génération voient tous deux le fournisseur terminé ; le second est refusé et rend la génération enregistrée.
      if (prev && job.storingAt && prev.storingAt && Date.now() - prev.storingAt < STORING && prev.storingBy !== job.storingBy && !TERMINAL.includes(prev.status)) {
        return Response.json({ ok: false, error: 'storing', job: prev }, { status: 409 })
      }
      // Copie d'un état plus ancien (encore active, sans `storingAt`) pendant qu'un autre suivi copie les fichiers : la marque reste,
      // sinon une annulation passerait pendant la copie et l'enregistrement final serait refusé.
      if (prev && !TERMINAL.includes(job.status) && !job.storingAt && prev.storingAt && Date.now() - prev.storingAt < STORING) Object.assign(job, { storingAt: prev.storingAt, storingBy: prev.storingBy })
      if (prev && TERMINAL.includes(prev.status) && job.status !== prev.status) return Response.json({ ok: false, error: 'terminal', status: prev.status, job: prev }, { status: 409 })
      if (prev && TERMINAL.includes(prev.status)) {
        job.refund = Math.max(prev.refund ?? 0, job.refund ?? 0)
        for (const k of ['failure', 'adminCancel', 'adminRefund']) if (prev[k] !== undefined) job[k] = prev[k]
      }
      await this.state.storage.put(`job:${job.id}`, job)
      await this.track(job.id, isActive(job)) // une génération terminée libère sa place
      if (isActive(job)) await this.wake()
      if (!job.storingAt) await this.record(jobItem(job), ...assetItems(job)) // l'étape « enregistrement en cours » n'est pas copiée
      return Response.json({ ok: true })
    }
    // Réservation d'une génération : même clé de demande → même génération (pas de second débit) ; sinon une place parmi
    // les générations actives du compte (au plus `max`), réservée tout de suite pour que deux envois simultanés ne la dépassent pas.
    if (pathname === '/job/claim') {
      const { key, jobId, max } = await request.json()
      if (await blocked()) return Response.json(BLOCKED, { status: 403 }) // avant le dédoublonnage : un compte bloqué ne relance rien
      const seen = key ? await this.state.storage.get(`idem:${key}`) : null
      if (seen) return Response.json({ ok: true, existing: seen })
      const active = Object.keys((await this.state.storage.get('active')) ?? {})
      if (active.length >= max) return Response.json({ ok: false, error: 'too_many_active', max }, { status: 429 })
      if (key) await this.state.storage.put(`idem:${key}`, jobId)
      await this.track(jobId, true)
      return Response.json({ ok: true })
    }
    if (pathname === '/job/release') {
      await this.track((await request.json()).jobId, false)
      return Response.json({ ok: true })
    }

    // Quota du jour d'une fonction gratuite (ex. `enhance`) : `quota:<nom>:<AAAA-MM-JJ>`. `undo` rend une utilisation qui a échoué.
    if (pathname === '/quota/use') {
      const { name, day, max, undo = false } = await request.json()
      const key = `quota:${name}:${day}`
      const used = (await this.state.storage.get(key)) ?? 0
      if (undo) { await this.state.storage.put(key, Math.max(0, used - 1)); return Response.json({ ok: true }) }
      if (used >= max) return Response.json({ ok: false, error: 'daily_limit', max }, { status: 429 })
      await this.state.storage.put(key, used + 1)
      return Response.json({ ok: true, remaining: max - used - 1 })
    }

    // Fichiers téléversés mesurés (durée, plus petit côté) : `media:<adresse fal>`, lus avant le débit d'un outil limité.
    if (pathname === '/media/put') {
      const { url: file, secs, short } = await request.json()
      await this.state.storage.put(`media:${file}`, { secs, short: short ?? null })
      return Response.json({ ok: true })
    }
    if (pathname === '/media/get') return Response.json((await this.state.storage.get(`media:${url.searchParams.get('url')}`)) ?? null)

    // Recharges Mobile Money : `topup:<référence>`, plus la liste des références (les plus récentes d'abord) pour l'historique.
    if (pathname === '/topup/get') return Response.json((await this.state.storage.get(`topup:${url.searchParams.get('ref')}`)) ?? null)
    if (pathname === '/topup/list') {
      const refs = ((await this.state.storage.get('topups')) ?? []).slice(0, Number(url.searchParams.get('limit') ?? 50))
      const found = await Promise.all(refs.map((r) => this.state.storage.get(`topup:${r}`)))
      return Response.json(found.filter(Boolean))
    }
    // Ouverture : au plus `max` recharges ouvertes à la fois (chacune envoie une demande sur un téléphone), vérifié et réservé d'un coup.
    if (pathname === '/topup/open') {
      const { topup, max } = await request.json()
      if (await blocked()) return Response.json(BLOCKED, { status: 403 })
      const refs = (await this.state.storage.get('topups')) ?? []
      const recent = await Promise.all(refs.slice(0, 20).map((r) => this.state.storage.get(`topup:${r}`)))
      const open = recent.filter((t) => t && isOpen(t) && topup.createdAt - t.createdAt < OPEN_WINDOW).length
      if (open >= max) return Response.json({ ok: false, error: 'too_many_open', max }, { status: 429 })
      await this.state.storage.put(`topup:${topup.reference}`, topup)
      await this.state.storage.put('topups', [topup.reference, ...refs].slice(0, TOPUP_INDEX))
      await this.record(topupItem(topup))
      return Response.json({ ok: true })
    }
    // Mise à jour partielle, seulement si la recharge est encore dans l'un des statuts `from` (jamais après un paiement abouti).
    if (pathname === '/topup/patch') {
      const { reference, from, ...fields } = await request.json()
      const t = await this.state.storage.get(`topup:${reference}`)
      if (!t || !from.includes(t.status)) return Response.json({ ok: false, topup: t ?? null })
      const next = { ...t, ...fields, updatedAt: Date.now() }
      await this.state.storage.put(`topup:${reference}`, next)
      await this.record(topupItem(next))
      return Response.json({ ok: true, topup: next })
    }

    // Le corps est lu AVANT le portefeuille : attendre le corps n'est pas une opération de stockage, une autre requête pourrait
    // écrire le portefeuille pendant ce temps et la nôtre réécrirait une copie périmée. Entre la lecture et l'écriture du portefeuille,
    // il n'y a ensuite que des opérations de stockage (rien ne s'intercale).
    const input = pathname === '/balance' ? null : await request.json()
    const w = await this.wallet()
    if (pathname === '/balance') return Response.json({ balance: w.balance })
    // État d'un paiement paygate (webhook ou lecture) : mise à jour de la recharge et crédit dans la même requête, donc sans croisement.
    // Le crédit est idempotent par référence : un webhook rejoué ou une lecture après le webhook ne crédite pas deux fois.
    if (pathname === '/topup/apply') {
      const { reference, payment, late } = input
      const t = await this.state.storage.get(`topup:${reference}`)
      if (!t) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
      const out = applyPayment(t, payment, { late })
      let credited = 0
      const items = []
      if (out.credit > 0) {
        const r = credit(w, { paymentId: reference, amount: out.credit })
        if (r.ok && !r.replay) { await this.state.storage.put('wallet', w); credited = out.credit; items.push(ledgerItem('credit', reference, out.credit, w.balance)) }
      }
      if (out.topup !== t) { await this.state.storage.put(`topup:${reference}`, out.topup); items.push(topupItem(out.topup)) }
      if (items.length) await this.record(...items)
      return Response.json({ ok: true, topup: out.topup, credited, mismatch: out.mismatch ?? false, balance: w.balance })
    }

    // ── Administration : chaque action d'argent se décide ici, en une requête (lecture, calcul, écriture) ──
    // Ajustement à la main : la clé de l'administrateur (« adm_… ») sert de référence au crédit ou au débit (types du grand livre
    // inchangés) ; le résultat est gardé sous `adm:<clé>`. Rejouée, la même clé rend ce résultat ; avec un autre montant : conflit.
    if (pathname === '/admin/adjust') {
      const { key, direction, amount, reason, actor } = input
      const prev = await this.state.storage.get(`adm:${key}`)
      if (prev) {
        if (prev.direction !== direction || prev.amount !== amount) return Response.json({ ok: false, error: 'key_conflict' }, { status: 409 })
        return Response.json({ ok: true, replayed: true, direction, amount, balance: w.balance })
      }
      const r = direction === 'credit' ? credit(w, { paymentId: key, amount }) : debit(w, { jobId: key, amount }) // jamais sous 0
      if (!r.ok) return Response.json(r, { status: 402 })
      await this.state.storage.put('wallet', w)
      await this.state.storage.put(`adm:${key}`, { direction, amount, reason, actor, at: Date.now() })
      if (!r.replay) await this.record(ledgerItem(direction, key, amount, w.balance))
      return Response.json({ ok: true, direction, amount, balance: w.balance })
    }
    // Remboursement d'une génération terminée : une seule fois par génération, au plus son débit ; noté sur la génération.
    if (pathname === '/job/refund') {
      const { jobId, amount, reason, actor, key } = input
      const seen = await kept(key) // même clé : le premier résultat, même si D1 ne l'a pas noté
      if (seen) {
        const same = seen.action === 'refund_job' && seen.ref === jobId && (seen.amount ?? null) === (amount ?? null)
        return same ? Response.json({ ...seen.result, replayed: true }) : Response.json({ ok: false, error: 'key_conflict' }, { status: 409 })
      }
      const job = await this.state.storage.get(`job:${jobId}`)
      if (!job) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
      if (!TERMINAL.includes(job.status)) return Response.json({ ok: false, error: 'job_active', status: job.status }, { status: 409 }) // voir /job/cancel
      if (!w.ops[`debit:${jobId}`]) return Response.json({ ok: false, error: 'no_debit' }, { status: 409 })
      const done = w.ops[`refund:${jobId}`]
      if (done) return Response.json({ ok: false, error: 'already_refunded', refunded: done.amount }, { status: 409 })
      const r = refund(w, { jobId, amount })
      await this.state.storage.put('wallet', w)
      const next = { ...job, refund: r.refunded, adminRefund: { at: Date.now(), actor, reason } }
      await this.state.storage.put(`job:${jobId}`, next)
      const result = { ok: true, refunded: r.refunded, balance: w.balance, job: next }
      await keep(key, { action: 'refund_job', ref: jobId, amount: amount ?? null, result })
      await this.record(ledgerItem('refund', jobId, r.refunded, w.balance), jobItem(next))
      return Response.json(result)
    }
    // Annulation d'une génération encore active, vérifiée, remboursée et notée en une requête (jamais une génération déjà terminée).
    // Par l'administration (bloquée chez le fournisseur, oubliée) : ce qui reste du débit est rendu. Par l'utilisateur (`user: true`) :
    // remboursée seulement si elle n'avait pas commencé. Elle passe CANCELED et libère sa place ; l'annulation chez le fournisseur
    // se fait avant, dans le Worker. Pendant la copie de ses fichiers dans R2 (`storingAt` récent), elle est en fait terminée : refusée.
    if (pathname === '/job/cancel') {
      const { jobId, reason, actor, user = false, key } = input
      const job = await this.state.storage.get(`job:${jobId}`)
      if (!job) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
      if (TERMINAL.includes(job.status)) return Response.json({ ok: false, error: 'not_active', status: job.status, job, balance: w.balance }, { status: 409 })
      if (job.storingAt && Date.now() - job.storingAt < STORING) return Response.json({ ok: false, error: 'storing', status: job.status, job, balance: w.balance }, { status: 409 })
      const owed = !user || job.status === 'IN_QUEUE'
      const r = owed && w.ops[`debit:${jobId}`] && !w.ops[`refund:${jobId}`] ? refund(w, { jobId }) : null
      if (r) await this.state.storage.put('wallet', w)
      const refunded = r?.refunded ?? 0
      const now = Date.now()
      const note = user ? {} : { failure: 'admin_cancel', adminCancel: { at: now, actor, reason } }
      const next = { ...job, status: 'CANCELED', refund: w.ops[`refund:${jobId}`]?.amount ?? 0, finishedAt: now, storingAt: undefined, storingBy: undefined, ...note }
      await this.state.storage.put(`job:${jobId}`, next)
      await this.track(jobId, false)
      if (!user) await keep(key, { action: 'cancel_job', ref: jobId, result: { outcome: 'canceled', job: next, refunded, balance: w.balance } }) // résultat rendu par la route
      await this.record(...(r ? [ledgerItem('refund', jobId, refunded, w.balance)] : []), jobItem(next))
      return Response.json({ ok: true, refunded, balance: w.balance, job: next })
    }

    // Échec d'une génération constaté chez le fournisseur : remboursée et passée FAILED en une requête, seulement si elle est encore
    // active (une génération annulée ou terminée entre-temps n'est ni remboursée ni réécrite : 409 avec la génération enregistrée).
    if (pathname === '/job/fail') {
      const { jobId, failure } = input
      const job = await this.state.storage.get(`job:${jobId}`)
      if (!job) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
      if (TERMINAL.includes(job.status)) return Response.json({ ok: false, error: 'terminal', status: job.status, job, balance: w.balance }, { status: 409 })
      // Fichiers en cours de copie (un autre suivi a vu la génération terminée) : c'est lui qui décide de l'issue.
      if (job.storingAt && Date.now() - job.storingAt < STORING) return Response.json({ ok: false, error: 'storing', status: job.status, job, balance: w.balance }, { status: 409 })
      const r = refund(w, { jobId })
      if (r.ok && !r.replay) await this.state.storage.put('wallet', w)
      const next = { ...job, status: 'FAILED', failure, refund: w.ops[`refund:${jobId}`]?.amount ?? job.cost, finishedAt: Date.now(), storingAt: undefined, storingBy: undefined }
      await this.state.storage.put(`job:${jobId}`, next)
      await this.track(jobId, false)
      await this.record(...(r.ok && !r.replay ? [ledgerItem('refund', jobId, r.refunded, w.balance)] : []), jobItem(next))
      return Response.json({ ok: true, refunded: r.refunded ?? 0, balance: w.balance, job: next })
    }

    const body = input
    const run = { '/debit': debit, '/refund': refund, '/credit': credit }[pathname]
    if (!run) return new Response('not found', { status: 404 })
    const result = run(w, body)
    if (result.ok && !result.replay) {
      await this.state.storage.put('wallet', w)
      const kind = pathname.slice(1)
      await this.record(ledgerItem(kind, body.jobId ?? body.paymentId, kind === 'refund' ? result.refunded : body.amount, w.balance))
    }
    return Response.json(result, { status: result.ok ? 200 : 402 })
  }
}
