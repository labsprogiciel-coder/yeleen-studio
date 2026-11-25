import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { highlightPlaceholders, internalHref, renderLegal, slug, wrapTables } from '../src/lib/legal.js'

const read = (name) => readFileSync(new URL(`../src/content/legal/${name}`, import.meta.url), 'utf8')

test('identifiant de section : minuscules, sans accents ni ponctuation', () => {
  assert.equal(slug('1. Le service'), '1-le-service')
  assert.equal(slug("4. Le prix d'une création"), '4-le-prix-d-une-creation')
  assert.equal(slug('Questions fréquentes'), 'questions-frequentes')
  assert.equal(slug('  Éditeur — Hébergeur !  '), 'editeur-hebergeur')
  assert.equal(slug(''), '')
})

test('blancs à remplir : jaune pour « À COMPLÉTER », violet pour « À DÉCIDER »', () => {
  assert.equal(
    highlightPlaceholders('<p>Date : [À COMPLÉTER : date de publication]. Âge : [À DÉCIDER : âge minimum].</p>'),
    '<p>Date : <mark class="lg-todo">[À COMPLÉTER : date de publication]</mark>. Âge : <mark class="lg-dec">[À DÉCIDER : âge minimum]</mark>.</p>',
  )
  assert.equal(highlightPlaceholders('<p>[Note] sans blanc</p>'), '<p>[Note] sans blanc</p>')
})

test('tableaux enveloppés pour défiler sur petit écran', () => {
  assert.equal(wrapTables('<table><tr><td>a</td></tr></table>'), '<div class="lg-tbl"><table><tr><td>a</td></tr></table></div>')
})

test('rendu : commentaire de tête retiré, h2 ancrés, h2 écrit en HTML gardé tel quel', () => {
  const html = renderLegal('<!-- note -->\n\n# Titre\n\n## 1. Le service\n\nTexte [À COMPLÉTER : x].\n\n<h2 id="mentions-legales">Mentions légales</h2>\n\n### Éditeur\n\n| A | B |\n|---|---|\n| 1 | 2 |\n')
  assert.ok(!html.includes('<!--'))
  assert.match(html, /<h1>Titre<\/h1>/)
  assert.match(html, /<h2 id="1-le-service">1\. Le service<\/h2>/)
  assert.match(html, /<h2 id="mentions-legales">Mentions légales<\/h2>/)
  assert.match(html, /<h3>Éditeur<\/h3>/)
  assert.match(html, /<mark class="lg-todo">\[À COMPLÉTER : x\]<\/mark>/)
  assert.match(html, /<div class="lg-tbl"><table>/)
})

test('les vrais textes : ancre des mentions légales, ids uniques, chaque blanc surligné', () => {
  for (const name of ['terms.md', 'privacy.md']) {
    const src = read(name).replace(/^\s*<!--[\s\S]*?-->/, '') // le commentaire de tête cite les deux formes de blanc
    const html = renderLegal(src)
    const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1])
    assert.ok(ids.length > 5, name)
    assert.equal(new Set(ids).size, ids.length, `${name} : ids en double`)
    const blanks = (src.match(/\[À (COMPLÉTER|DÉCIDER)[^\]]*\]/g) ?? []).length
    assert.equal((html.match(/<mark class="lg-(todo|dec)">/g) ?? []).length, blanks, name)
  }
  assert.ok(renderLegal(read('terms.md')).includes('<h2 id="mentions-legales">'))
})

test('liens internes ouverts sans recharger ; les autres laissés au navigateur', () => {
  const origin = 'https://qreativ.app'
  const a = (href, attrs = {}) => ({ target: attrs.target ?? '', getAttribute: (k) => (k === 'href' ? href : null), hasAttribute: (k) => k in attrs })
  const click = { button: 0, defaultPrevented: false }
  assert.equal(internalHref(a('/privacy'), click, origin), '/privacy')
  assert.equal(internalHref(a('/terms#mentions-legales'), click, origin), '/terms#mentions-legales')
  assert.equal(internalHref(a('https://www.vecteezy.com'), click, origin), null)
  assert.equal(internalHref(a('//evil.example/x'), click, origin), null)
  assert.equal(internalHref(a('mailto:contact@qreativ.app'), click, origin), null)
  assert.equal(internalHref(a('/privacy', { target: '_blank' }), click, origin), null)
  assert.equal(internalHref(a('/privacy', { download: '' }), click, origin), null)
  assert.equal(internalHref(a('/privacy'), { ...click, ctrlKey: true }, origin), null)
  assert.equal(internalHref(a('/privacy'), { ...click, button: 1 }, origin), null)
  assert.equal(internalHref(null, click, origin), null)
})
