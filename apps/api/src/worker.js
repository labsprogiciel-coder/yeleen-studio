import * as Sentry from '@sentry/cloudflare'
import app from './index.js'
import { Account as PlainAccount } from './account-do.js'
import { sentryOptions } from './sentry.js'

/**
 * Point d'entrée du Worker (`main` dans wrangler.jsonc) : l'API (index.js) et le Durable Object Account, enveloppés par Sentry.
 * Les tests utilisent index.js et account-do.js directement, sans Sentry.
 */
export default Sentry.withSentry(sentryOptions, { fetch: (request, env, ctx) => app.fetch(request, env, ctx) })

export const Account = Sentry.instrumentDurableObjectWithSentry(sentryOptions, PlainAccount)
