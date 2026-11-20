import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialCollapsed, RAIL_KEY } from '../src/lib/railPrefs.js'

test('sans choix enregistré : agrandie sur grand écran, réduite ailleurs', () => {
  assert.equal(initialCollapsed(null, 1440), false)
  assert.equal(initialCollapsed(null, 1280), false)
  assert.equal(initialCollapsed(null, 1279), true)
  assert.equal(initialCollapsed(undefined, 390), true)
  assert.equal(initialCollapsed(null, undefined), true)
})

test('un choix enregistré l’emporte sur la largeur ; une valeur inconnue est ignorée', () => {
  assert.equal(initialCollapsed('collapsed', 1920), true)
  assert.equal(initialCollapsed('expanded', 800), false)
  assert.equal(initialCollapsed('n’importe quoi', 1440), false)
  assert.ok(RAIL_KEY.startsWith('studio.'))
})
