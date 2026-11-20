import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayName, emailLocal, helpLink, initials, placeAccountMenu } from '../src/lib/accountMenu.js'

test('nom affiché : nom complet, puis prénom et nom, identifiant, début de l’adresse, sinon « Mon compte »', () => {
  assert.equal(displayName({ fullName: '  Awa   Traoré ', email: 'a@b.co' }), 'Awa Traoré')
  assert.equal(displayName({ firstName: 'Kofi', lastName: null, email: 'k@b.co' }), 'Kofi')
  assert.equal(displayName({ username: 'kofi_a', email: 'k@b.co' }), 'kofi_a')
  assert.equal(displayName({ email: 'awa.traore@exemple.com' }), 'awa.traore')
  assert.equal(displayName({}), 'Mon compte')
  assert.equal(displayName(), 'Mon compte')
  assert.equal(emailLocal('pas-une-adresse'), 'pas-une-adresse')
  assert.equal(emailLocal(null), '')
})

test('initiales : deux au plus, en capitales, accents gardés', () => {
  assert.equal(initials('Awa Traoré'), 'AT')
  assert.equal(initials('awa.traore'), 'AT')
  assert.equal(initials('Jean Pierre de la Fontaine'), 'JF')
  assert.equal(initials('élodie'), 'É')
  assert.equal(initials('  '), '?')
  assert.equal(initials('(Kofi) Mensah'), 'KM')
})

test('aide : WhatsApp d’abord, sinon l’e-mail, sinon rien', () => {
  assert.deepEqual(helpLink({ whatsapp: '22670123456', email: 'a@b.co' }), { href: 'https://wa.me/22670123456', external: true, via: 'WhatsApp' })
  assert.deepEqual(helpLink({ whatsapp: null, email: 'a@b.co' }), { href: 'mailto:a@b.co', external: false, via: 'e-mail' })
  assert.equal(helpLink({ whatsapp: null, email: null }), null)
  assert.equal(helpLink(), null)
})

const inside = (p, menu, vp, gutter) => {
  assert.ok(p.left >= gutter, `left ${p.left}`)
  assert.ok(p.left + p.width <= vp.width - gutter, `right ${p.left + p.width}`)
  assert.ok(p.top >= gutter, `top ${p.top}`)
  assert.ok(p.top + Math.min(menu.height, p.maxHeight) <= vp.height - gutter, `bottom ${p.top + Math.min(menu.height, p.maxHeight)}`)
}

test('grand écran : à droite de la barre, bas aligné sur le bouton', () => {
  const vp = { width: 1440, height: 900 }
  const menu = { width: 300, height: 420 }
  const p = placeAccountMenu({ trigger: { left: 24, top: 830, right: 230, bottom: 874 }, railRight: 242, menu, viewport: vp })
  assert.deepEqual(p, { left: 250, top: 454, width: 300, maxHeight: 884, side: 'right' })
  inside(p, menu, vp, 8)
})

test('grand écran : jamais au-dessus ni en dessous de l’écran', () => {
  const vp = { width: 1000, height: 400 }
  const menu = { width: 300, height: 420 }
  const p = placeAccountMenu({ trigger: { left: 10, top: 340, right: 60, bottom: 384 }, railRight: 82, menu, viewport: vp })
  assert.equal(p.top, 8)
  assert.equal(p.maxHeight, 384)
  inside(p, menu, vp, 8)
  const high = placeAccountMenu({ trigger: { left: 10, top: 20, right: 60, bottom: 64 }, railRight: 82, menu: { width: 300, height: 200 }, viewport: vp })
  assert.equal(high.top, 8)
})

test('grand écran : sans place à droite, la fenêtre recule dans l’écran', () => {
  const vp = { width: 920, height: 800 }
  const p = placeAccountMenu({ trigger: { left: 700, top: 700, right: 800, bottom: 744 }, railRight: 810, menu: { width: 300, height: 300 }, viewport: vp })
  assert.equal(p.left, 920 - 8 - 300)
})

test('téléphone : sous le bouton, alignée à droite, dans des marges de 16 px', () => {
  const vp = { width: 390, height: 844 }
  const menu = { width: 300, height: 420 }
  const p = placeAccountMenu({ trigger: { left: 330, top: 14, right: 374, bottom: 58 }, railRight: 382, menu, viewport: vp })
  assert.deepEqual(p, { left: 74, top: 66, width: 300, maxHeight: 762, side: 'below' })
  inside(p, menu, vp, 16)
})

test('téléphone étroit : la fenêtre rétrécit pour tenir entre les marges', () => {
  const vp = { width: 300, height: 600 }
  const menu = { width: 300, height: 700 }
  const p = placeAccountMenu({ trigger: { left: 250, top: 10, right: 290, bottom: 50 }, menu, viewport: vp })
  assert.equal(p.width, 268)
  assert.equal(p.left, 16)
  assert.equal(p.maxHeight, 600 - 58 - 16)
  inside(p, menu, vp, 16)
})

test('900 px compte comme téléphone, 901 px comme grand écran', () => {
  const args = { trigger: { left: 800, top: 10, right: 844, bottom: 54 }, menu: { width: 300, height: 300 } }
  assert.equal(placeAccountMenu({ ...args, viewport: { width: 900, height: 800 } }).side, 'below')
  assert.equal(placeAccountMenu({ ...args, viewport: { width: 901, height: 800 } }).side, 'right')
})
