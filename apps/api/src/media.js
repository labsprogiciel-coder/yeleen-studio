/**
 * Durée et taille d'un fichier vidéo ou audio, lues dans son en-tête au téléversement (POST /uploads), sans dépendance.
 * Sert aux outils facturés pour une durée ou une résolution maximale : le serveur vérifie lui-même le fichier avant le débit,
 * au lieu de croire le navigateur. Formats lus : MP4, MOV et M4A (ISO BMFF), WAV, MP3. Les autres rendent null (non mesurés).
 * Retourne { secs, short } : `short` est le plus petit côté de l'image (1080 pour une vidéo 1080p, en portrait comme en
 * paysage), null pour un audio.
 */
export function mediaInfo(buffer, type) {
  const b = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer)
  try {
    if (/^(video\/(mp4|quicktime)|audio\/(mp4|x-m4a))$/.test(type)) return isoInfo(b)
    if (/^audio\/(wav|x-wav)$/.test(type)) return wavInfo(b)
    if (/^audio\/(mpeg|mp3)$/.test(type)) return mp3Info(b)
  } catch { /* en-tête tronqué ou illisible : non mesuré */ }
  return null
}

const tag = (b, at) => String.fromCharCode(b.getUint8(at), b.getUint8(at + 1), b.getUint8(at + 2), b.getUint8(at + 3))
const u64 = (b, at) => b.getUint32(at) * 2 ** 32 + b.getUint32(at + 4)

/** Boîtes ISO BMFF entre `from` et `to` : [{ type, start (contenu), end }]. */
function boxes(b, from, to) {
  const out = []
  for (let at = from; at + 8 <= to;) {
    let size = b.getUint32(at)
    let head = 8
    if (size === 1) { size = u64(b, at + 8); head = 16 } else if (size === 0) size = to - at
    if (size < head || at + size > to) break
    out.push({ type: tag(b, at + 4), start: at + head, end: at + size })
    at += size
  }
  return out
}

function isoInfo(b) {
  const moov = boxes(b, 0, b.byteLength).find((x) => x.type === 'moov')
  if (!moov) return null
  const inner = boxes(b, moov.start, moov.end)
  const mvhd = inner.find((x) => x.type === 'mvhd')
  if (!mvhd) return null
  const v1 = b.getUint8(mvhd.start) === 1
  const scale = b.getUint32(mvhd.start + (v1 ? 20 : 12))
  const dur = v1 ? u64(b, mvhd.start + 24) : b.getUint32(mvhd.start + 16)
  if (!scale) return null
  // Taille de l'image : la plus grande piste vidéo (tkhd, largeur et hauteur en 16.16).
  let short = null
  for (const trak of inner.filter((x) => x.type === 'trak')) {
    const tkhd = boxes(b, trak.start, trak.end).find((x) => x.type === 'tkhd')
    if (!tkhd) continue
    const at = tkhd.start + (b.getUint8(tkhd.start) === 1 ? 88 : 76)
    const w = b.getUint32(at) / 65536
    const h = b.getUint32(at + 4) / 65536
    if (w > 0 && h > 0) short = Math.max(short ?? 0, Math.round(Math.min(w, h)))
  }
  return { secs: Math.round((dur / scale) * 10) / 10, short }
}

function wavInfo(b) {
  if (tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WAVE') return null
  let rate = 0
  for (let at = 12; at + 8 <= b.byteLength;) {
    const id = tag(b, at)
    const size = b.getUint32(at + 4, true)
    if (id === 'fmt ') rate = b.getUint32(at + 16, true) // octets par seconde
    if (id === 'data' && rate) return { secs: Math.round((Math.min(size, b.byteLength - at - 8) / rate) * 10) / 10, short: null }
    at += 8 + size + (size % 2)
  }
  return null
}

// MP3 (couche III) : débits en kbit/s et fréquences, MPEG-1 puis MPEG-2 et 2.5.
const KBPS = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] }
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } // clé : bits de version

function mp3Info(b) {
  let at = 0
  if (tag(b, 0).startsWith('ID3')) { // balise ID3v2 : taille sur 4 octets de 7 bits
    at = 10 + ((b.getUint8(6) << 21) | (b.getUint8(7) << 14) | (b.getUint8(8) << 7) | b.getUint8(9))
  }
  for (; at + 4 <= b.byteLength; at++) if (b.getUint8(at) === 0xff && (b.getUint8(at + 1) & 0xe0) === 0xe0) break
  if (at + 4 > b.byteLength) return null
  const h = b.getUint32(at)
  const version = (h >>> 19) & 3 // 3 : MPEG-1, 2 : MPEG-2, 0 : MPEG-2.5
  const layer = (h >>> 17) & 3
  if (layer !== 1 || version === 1) return null // couche III seulement
  const kbps = KBPS[version === 3 ? 1 : 2][(h >>> 12) & 15]
  const rate = RATES[version]?.[(h >>> 10) & 3]
  if (!kbps || !rate) return null
  const perFrame = version === 3 ? 1152 : 576
  // En-tête Xing / Info (débit variable) : nombre de trames exact.
  const mono = ((h >>> 6) & 3) === 3
  const side = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17)
  const x = at + 4 + side
  if (x + 12 <= b.byteLength && ['Xing', 'Info'].includes(tag(b, x)) && b.getUint32(x + 4) & 1) {
    return { secs: Math.round(((b.getUint32(x + 8) * perFrame) / rate) * 10) / 10, short: null }
  }
  return mp3Frames(b, at)
}

/**
 * Sans en-tête Xing : on additionne la durée de chaque trame (le débit peut changer d'une trame à l'autre). Si les trames lues
 * ne couvrent pas presque tout le fichier (données inconnues, trames abîmées), la durée n'est pas sûre : non mesuré.
 */
function mp3Frames(b, first) {
  let at = first
  let secs = 0
  while (at + 4 <= b.byteLength) {
    const h = b.getUint32(at)
    if ((h >>> 21) !== 0x7ff) break
    const version = (h >>> 19) & 3
    const kbps = KBPS[version === 3 ? 1 : 2][(h >>> 12) & 15]
    const rate = RATES[version]?.[(h >>> 10) & 3]
    if (((h >>> 17) & 3) !== 1 || !kbps || !rate) break
    const perFrame = version === 3 ? 1152 : 576
    const size = Math.floor(((perFrame / 8) * kbps * 1000) / rate) + ((h >>> 9) & 1)
    secs += perFrame / rate
    at += size
  }
  if (at - first < (b.byteLength - first) * 0.9) return null
  return { secs: Math.round(secs * 10) / 10, short: null }
}
