import { useState } from 'react'
import Icon from '../lib/icons.jsx'
import { fileUrl } from '../lib/api.js'

/**
 * Vignette d'un style : l'image déposée dans le bucket (`templates/styles/<id>.jpg`) sur le dégradé du style. Tant que l'image
 * n'existe pas (ou sans API), seul le dégradé se voit.
 */
export function StyleThumb({ style }) {
  const [broken, setBroken] = useState(false)
  const src = fileUrl(`templates/styles/${style.id}.jpg`)
  return (
    <span className="st-thumb" style={{ background: style.poster }} aria-hidden="true">
      {src && !broken && <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />}
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
