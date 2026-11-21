import { useState } from 'react'
import Icon from '../lib/icons.jsx'
import { fileUrl } from '../lib/api.js'

// Aperçus des styles dans le bucket : `v2/` parce que les fichiers sont servis « immutable » (un an) : changer d'aperçu = changer de dossier.
const PREVIEW = 'templates/styles/v2'
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Vignette d'un style : l'image du bucket sur le dégradé du style. Avec `loop` (la grille des styles), une boucle vidéo de quelques
 * secondes, muette, joue par-dessus l'image, sauf si l'utilisateur limite les animations. Sans fichier (ou sans API) : le dégradé.
 */
export function StyleThumb({ style, loop = false }) {
  const [broken, setBroken] = useState(false)
  const [noVideo, setNoVideo] = useState(false)
  const src = fileUrl(`${PREVIEW}/${style.id}.jpg`)
  const video = loop && !noVideo && !reducedMotion() ? fileUrl(`${PREVIEW}/${style.id}.mp4`) : null
  return (
    <span className="st-thumb" style={{ background: style.poster }} aria-hidden="true">
      {src && !broken && <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />}
      {video && <video src={video} muted loop autoPlay playsInline preload="metadata" disablePictureInPicture tabIndex={-1} onError={() => setNoVideo(true)} />}
    </span>
  )
}

/** Le style choisi, dans Références : sa vignette, son nom ; toucher la case rouvre le choix, × le retire. */
export function StyleChip({ style, onOpen, onClear }) {
  return (
    <div className="ep-from ep-style">
      <StyleThumb style={style} />
      <button type="button" className="ep-pick" aria-label={`Changer de style (actuel : ${style.label})`} onClick={onOpen} />
      <span><small>Style</small><b>{style.label}</b></span>
      <button type="button" className="ep-x" aria-label={`Retirer le style ${style.label}`} onClick={onClear}><Icon name="close" size={12} /></button>
    </div>
  )
}

