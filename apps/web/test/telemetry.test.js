import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bareUrl, cleanAnalyticsEvent, isAdminUrl, posthogOptions, sentryBreadcrumb, sentryEvent } from '../src/lib/telemetry.js'

test('PostHog : clics sans texte ni attributs, jamais de valeur de champ ni de texte copié, administration exclue', () => {
  const o = posthogOptions('https://eu.i.posthog.com')
  assert.equal(o.mask_all_text, true)
  assert.equal(o.mask_all_element_attributes, true)
  assert.equal(o.disable_session_recording, true)
  assert.equal(o.capture_exceptions, false)
  assert.equal(o.person_profiles, 'identified_only')
  assert.equal(o.autocapture.capture_copied_text, false)
  assert.deepEqual(o.autocapture.capture_value_css_selector_allowlist, [])
  assert.ok(o.property_denylist.includes('$el_text'))
  assert.equal(o.before_send, cleanAnalyticsEvent)
  assert.equal(o.sanitize_properties, undefined) // remplacée par before_send (dépréciée dans posthog-js)
  // Le SDK compare chaque motif à l'adresse complète (new RegExp(motif).test(href)).
  const ignored = (href) => o.autocapture.url_ignorelist.some((m) => new RegExp(m).test(href))
  for (const href of ['https://yeleen.app/admin', 'https://yeleen.app/admin/', 'https://yeleen.app/admin?tab=users', 'http://localhost:5174/admin#x']) assert.ok(ignored(href), href)
  for (const href of ['https://yeleen.app/', 'https://yeleen.app/administration', 'https://yeleen.app/studio?admin=1', 'https://yeleen.app/x/admin']) assert.ok(!ignored(href), href)
})

test('PostHog, before_send : aucun clic relevé en administration ; pages vues gardées', () => {
  for (const event of ['$autocapture', '$rageclick', '$dead_click', '$copy_autocapture']) {
    assert.equal(cleanAnalyticsEvent({ event, properties: { $current_url: 'https://yeleen.app/admin?q=a@b.c' } }), null, event)
    assert.equal(cleanAnalyticsEvent({ event, properties: { $pathname: '/admin/users' } }), null, event)
    assert.ok(cleanAnalyticsEvent({ event, properties: { $current_url: 'https://yeleen.app/studio' } }), event)
  }
  const view = cleanAnalyticsEvent({ event: '$pageview', properties: { $current_url: 'https://yeleen.app/admin?q=70123456' } })
  assert.equal(view.properties.$current_url, 'https://yeleen.app/admin')
  // Carte de chaleur : jamais envoyée, même depuis une page ordinaire (points rangés par adresse complète, relevés ailleurs peut-être).
  assert.equal(cleanAnalyticsEvent({ event: '$$heatmap', properties: { $current_url: 'https://yeleen.app/studio', $heatmap_data: { 'https://yeleen.app/admin?u=user_bob': [{ x: 1 }] } } }), null)
  assert.ok(isAdminUrl('/admin') && isAdminUrl('https://x/admin/') && !isAdminUrl('/administration') && !isAdminUrl(undefined))
})

test('PostHog, before_send : adresses sans paramètres partout (événement, profil) ; ni texte de la page', () => {
  const e = cleanAnalyticsEvent({
    event: '$autocapture',
    properties: {
      $current_url: 'https://yeleen.app/recharge/retour?ref=TP-1&result=success', $referrer: 'https://pay.example/?phone=1#x', $pathname: '/studio',
      $prev_pageview_pathname: '/a?b', $external_click_url: 'https://out?x', $el_text: 'un chat sous la pluie', $selected_content: 'x', $input_value: 'y',
      $set: { $current_url: 'https://yeleen.app/?t=1' }, $elements_chain: 'img:nth-child="1"', $event_type: 'click',
    },
    $set_once: { $initial_current_url: 'https://yeleen.app/?token=abc', $initial_referrer: '$direct', $initial_pathname: '/' },
    $set: { $current_url: 'https://yeleen.app/a?b' },
  })
  assert.equal(e.properties.$current_url, 'https://yeleen.app/recharge/retour')
  assert.equal(e.properties.$referrer, 'https://pay.example/')
  assert.equal(e.properties.$prev_pageview_pathname, '/a')
  assert.equal(e.properties.$pathname, '/studio')
  for (const k of ['$el_text', '$selected_content', '$input_value', '$external_click_url']) assert.equal(k in e.properties, false, k)
  assert.equal(e.properties.$set.$current_url, 'https://yeleen.app/')
  assert.deepEqual(e.$set_once, { $initial_current_url: 'https://yeleen.app/', $initial_referrer: '$direct', $initial_pathname: '/' })
  assert.equal(e.$set.$current_url, 'https://yeleen.app/a')
  assert.equal(e.properties.$event_type, 'click')
  assert.equal(bareUrl(42), 42)
})

test('PostHog : ni carte de chaleur ni mesures de performance ; un clic perd les propriétés venues de data-ph-capture-attribute-*', () => {
  const o = posthogOptions('https://eu.i.posthog.com')
  assert.equal(o.capture_heatmaps, false)
  assert.equal(o.capture_performance, false)
  const click = cleanAnalyticsEvent({ event: '$autocapture', properties: { token: 'phc', distinct_id: 'd', $event_type: 'click', 'user-email': 'bob@example.test', prompt: 'un chat' } })
  assert.deepEqual(click.properties, { token: 'phc', distinct_id: 'd', $event_type: 'click' })
  // Les événements nommés (`track`) gardent leurs propriétés.
  assert.deepEqual(cleanAnalyticsEvent({ event: 'topup_started', properties: { token: 'phc', pack: 'studio' } }).properties, { token: 'phc', pack: 'studio' })
})

test('Sentry (site) : événement sans paramètres d’adresse, en-têtes, cookies ni corps', () => {
  const e = sentryEvent({ request: { url: 'https://yeleen.app/admin?q=a@b.c', query_string: 'q=a@b.c', headers: { a: 'b' }, cookies: 'c', data: 'd' } })
  assert.deepEqual(e.request, { url: 'https://yeleen.app/admin' })
  assert.deepEqual(sentryEvent({ message: 'm' }), { message: 'm' })
})

test('Sentry (site), fil d’Ariane : pas de console ; réseau sans paramètres ni corps ; clics sans valeur d’attribut', () => {
  assert.equal(sentryBreadcrumb({ category: 'console', message: 'consigne' }), null)
  assert.deepEqual(
    sentryBreadcrumb({ category: 'fetch', type: 'http', level: 'info', data: { method: 'POST', url: 'https://api/topups/options?phone=70123456', status_code: 200, request_body_size: 80, body: '{"phone":"70123456"}' } }),
    { category: 'fetch', type: 'http', level: 'info', data: { method: 'POST', url: 'https://api/topups/options', status_code: 200 } },
  )
  assert.deepEqual(sentryBreadcrumb({ category: 'xhr', type: 'http', data: { method: 'GET', url: '/x?y=1' } }), { category: 'xhr', type: 'http', data: { method: 'GET', url: '/x' } })
  // Forme des miettes de clic de @sentry/browser (htmlTreeAsString : aria-label, type, name, title, alt).
  const click = sentryBreadcrumb({ category: 'ui.click', message: 'div.grid > button.card[aria-label="Ouvrir : un chat sous la pluie"] > img[alt="un chat sous la pluie"][title=\'a@b.c\']', data: { 'ui.component_name': 'Card' } })
  assert.equal(click.message, 'div.grid > button.card[aria-label] > img[alt][title]')
  assert.deepEqual(click.data, { 'ui.component_name': 'Card' })
  assert.deepEqual(sentryBreadcrumb({ category: 'navigation', data: { from: '/recharge/retour?ref=TP-1', to: '/studio#x' } }), { category: 'navigation', data: { from: '/recharge/retour', to: '/studio' } })
  const other = { category: 'sentry.event', message: 'x' }
  assert.equal(sentryBreadcrumb(other), other)
})
