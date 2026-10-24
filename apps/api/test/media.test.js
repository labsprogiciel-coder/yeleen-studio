import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mediaInfo } from '../src/media.js'

/** Fichiers de test minimaux, construits octet par octet. */
const bytes = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u32le = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
const ascii = (s) => [...s].map((ch) => ch.charCodeAt(0))
const box = (type, ...payload) => { const body = bytes(...payload); return bytes(u32(8 + body.length), ascii(type), body) }

/** MP4 : `secs` secondes, une piste vidéo w × h (tkhd version 0). */
function mp4(secs, w, h) {
  const mvhd = box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(secs * 1000), new Array(80).fill(0))
  const tkhd = box('tkhd', [0, 0, 0, 0], new Array(72).fill(0), u32(w * 65536), u32(h * 65536))
  return bytes(box('ftyp', ascii('isom'), u32(0)), box('moov', mvhd, box('trak', tkhd))).buffer
}

test('MP4 et MOV : durée (mvhd) et plus petit côté de la piste vidéo, en portrait comme en paysage', () => {
  assert.deepEqual(mediaInfo(mp4(12, 1920, 1080), 'video/mp4'), { secs: 12, short: 1080 })
  assert.deepEqual(mediaInfo(mp4(8, 2160, 3840), 'video/quicktime'), { secs: 8, short: 2160 })
  assert.equal(mediaInfo(new Uint8Array([0, 0, 0, 8, 1, 2, 3, 4]).buffer, 'video/mp4'), null) // pas de moov
})

test('WAV : durée = taille des données / octets par seconde', () => {
  const rate = 44100 * 2 * 2 // stéréo 16 bits
  const fmt = bytes(ascii('fmt '), u32le(16), [1, 0, 2, 0], u32le(44100), u32le(rate), [4, 0, 16, 0])
  const data = bytes(ascii('data'), u32le(rate * 3), new Array(64).fill(0)) // en-tête de 3 s, contenu tronqué
  const wav = bytes(ascii('RIFF'), u32le(0), ascii('WAVE'), fmt, data)
  assert.equal(mediaInfo(wav.buffer, 'audio/wav').secs, Math.round((64 / rate) * 10) / 10) // la partie réellement présente
})

test('MP3 : débit constant d’après la taille, ou nombre de trames de l’en-tête Xing', () => {
  const frame = [0xff, 0xfb, 0x90, 0x00] // MPEG-1 couche III, 128 kbit/s, 44,1 kHz, stéréo
  const cbr = bytes(frame, new Array(16000 * 5 - 4).fill(0)) // 5 s à 16 000 octets par seconde
  assert.equal(mediaInfo(cbr.buffer, 'audio/mpeg').secs, 5)
  const xing = bytes(frame, new Array(32).fill(0), ascii('Xing'), u32(1), u32(Math.round((60 * 44100) / 1152)), new Array(100).fill(0))
  assert.equal(Math.round(mediaInfo(xing.buffer, 'audio/mpeg').secs), 60)
})

test('formats non lus : non mesurés (null)', () => {
  assert.equal(mediaInfo(new Uint8Array(64).buffer, 'video/webm'), null)
  assert.equal(mediaInfo(new Uint8Array(64).buffer, 'audio/ogg'), null)
})

export { mp4 }
