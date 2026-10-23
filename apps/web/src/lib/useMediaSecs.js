// lib/useMediaSecs.js
import { useEffect, useState } from 'react'
export default function useMediaSecs(file, kind = 'audio') {
  const [secs, setSecs] = useState(null)
  useEffect(() => {
    if (!file) return setSecs(null)
    const url = URL.createObjectURL(file)
    const el = document.createElement(kind)
    el.preload = 'metadata'
    el.onloadedmetadata = () => setSecs(Math.round(el.duration * 10) / 10)
    el.onerror = () => setSecs(NaN)
    el.src = url
    return () => { el.removeAttribute('src'); URL.revokeObjectURL(url) }
  }, [file, kind])
  return secs
}
