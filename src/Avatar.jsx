import { useState } from 'react'

// Every avatar render in the app follows the same two-class convention:
// {baseClass} on the <img>, {baseClass} {baseClass}-fallback on the emoji
// shown when there's no URL. This also falls back on a broken/dead URL
// (via onError) — a URL existing doesn't mean it actually loads.
export default function Avatar({ src, baseClass, emoji = '🙂' }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return <span className={`${baseClass} ${baseClass}-fallback`}>{emoji}</span>
  }
  return <img src={src} alt="" className={baseClass} onError={() => setFailed(true)} />
}
