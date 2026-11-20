import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { avatarUrl, ensureUser, getUser, markWelcomed, resetUserCache } from '../src/users.js'
import { testD1 } from './d1.js'

const MIN = 60_000
beforeEach(() => resetUserCache())

test('première visite : la ligne est créée avec son pays et son profil', async () => {
  const db = testD1()
  const r = await ensureUser(db, 'user_a1', { email: 'a@example.com', name: 'Awa', country: 'BF' }, 1000)
  assert.equal(r.created, true)
  assert.deepEqual({ ...(await getUser(db, 'user_a1')) }, { id: 'user_a1', createdAt: 1000, lastSeenAt: 1000, email: 'a@example.com', name: 'Awa', country: 'BF', welcomedAt: null, avatarUrl: null })
})

test('visites suivantes : D1 n’est pas interrogé dans les 10 minutes, puis la date est mise à jour', async () => {
  const db = testD1()
  await ensureUser(db, 'user_a1', { country: 'BF' }, 1000)
  const after = db.calls
  assert.equal((await ensureUser(db, 'user_a1', {}, 1000 + 5 * MIN)).cached, true)
  assert.equal(db.calls, after) // aucune requête
  const r = await ensureUser(db, 'user_a1', {}, 1000 + 11 * MIN)
  assert.equal(r.created, false)
  const u = await getUser(db, 'user_a1')
  assert.equal(u.lastSeenAt, 1000 + 11 * MIN)
  assert.equal(u.createdAt, 1000) // la création ne bouge pas
  assert.equal(u.country, 'BF') // le pays est celui de la première connexion
})

test('un profil inconnu n’efface jamais un profil connu ; un nouveau l’emporte', async () => {
  const db = testD1()
  await ensureUser(db, 'user_a1', { email: 'a@example.com', name: 'Awa' }, 1000)
  await ensureUser(db, 'user_a1', { email: null, name: null }, 1000 + 20 * MIN)
  assert.equal((await getUser(db, 'user_a1')).email, 'a@example.com')
  await ensureUser(db, 'user_a1', { email: 'b@example.com' }, 1000 + 40 * MIN)
  const u = await getUser(db, 'user_a1')
  assert.equal(u.email, 'b@example.com')
  assert.equal(u.name, 'Awa')
})

test('deux utilisateurs restent séparés', async () => {
  const db = testD1()
  await ensureUser(db, 'user_a1', { country: 'BF' }, 1000)
  const b = await ensureUser(db, 'user_b2', { country: 'SN' }, 1000)
  assert.equal(b.created, true)
  assert.equal((await getUser(db, 'user_b2')).country, 'SN')
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2)
})

test('le crédit de bienvenue ne se marque qu’une fois', async () => {
  const db = testD1()
  await ensureUser(db, 'user_a1', {}, 1000)
  assert.equal(await markWelcomed(db, 'user_a1', 2000), true)
  assert.equal(await markWelcomed(db, 'user_a1', 3000), false)
  assert.equal((await getUser(db, 'user_a1')).welcomedAt, 2000)
})

test('photo de profil : lue dans `picture` (sinon `image_url`), https seulement, 500 caractères au plus', () => {
  const ok = 'https://img.clerk.com/eyJ0eXBlIjoicHJveHkifQ'
  assert.equal(avatarUrl({ picture: ok }), ok)
  assert.equal(avatarUrl({ image_url: ok }), ok)
  assert.equal(avatarUrl({ picture: ok, image_url: 'https://autre.example/x.png' }), ok) // `picture` d'abord
  for (const bad of [undefined, null, '', 42, 'http://img.clerk.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//img.clerk.com/a.png',
    'https://user:pass@img.clerk.com/a.png', 'https://img.clerk.com/a b.png', `https://img.clerk.com/${'a'.repeat(480)}`, 'pas une adresse']) {
    assert.equal(avatarUrl({ picture: bad }), null, String(bad))
  }
  assert.equal(avatarUrl(), null)
})

test('photo de profil : gardée avec le profil, jamais effacée par un jeton sans photo, remplacée quand elle change', async () => {
  const db = testD1()
  await ensureUser(db, 'user_a1', { email: 'a@example.com', avatarUrl: 'https://img.clerk.com/a1' }, 1000)
  assert.equal((await getUser(db, 'user_a1')).avatarUrl, 'https://img.clerk.com/a1')
  await ensureUser(db, 'user_a1', { avatarUrl: null }, 1000 + 20 * MIN)
  assert.equal((await getUser(db, 'user_a1')).avatarUrl, 'https://img.clerk.com/a1')
  // Même photo : la ligne n'est pas réécrite (sa date ne bouge pas).
  await ensureUser(db, 'user_a1', { avatarUrl: 'https://img.clerk.com/a1' }, 1000 + 40 * MIN)
  assert.equal(db.raw.prepare('SELECT updated_at FROM user_avatars WHERE user_id = ?').get('user_a1').updated_at, 1000)
  // Nouvelle photo, mais dans les 10 minutes : rien n'est lu ni écrit (le même cache que le profil).
  const calls = db.calls
  await ensureUser(db, 'user_a1', { avatarUrl: 'https://img.clerk.com/a2' }, 1000 + 45 * MIN)
  assert.equal(db.calls, calls)
  await ensureUser(db, 'user_a1', { avatarUrl: 'https://img.clerk.com/a2' }, 1000 + 60 * MIN)
  assert.equal((await getUser(db, 'user_a1')).avatarUrl, 'https://img.clerk.com/a2')
  assert.equal(db.raw.prepare('SELECT updated_at FROM user_avatars WHERE user_id = ?').get('user_a1').updated_at, 1000 + 60 * MIN)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM user_avatars').get().n, 1)
  // Sans photo : aucune ligne.
  await ensureUser(db, 'user_b2', { email: 'b@example.com' }, 1000)
  assert.equal((await getUser(db, 'user_b2')).avatarUrl, null)
})
