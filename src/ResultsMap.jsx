import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'

// Argentina's full extent (mainland + Tierra del Fuego), so the map opens
// showing the whole country and can be freely zoomed/panned within it —
// not locked to Buenos Aires like UbicaBA's city-scale map was.
const ARGENTINA_BOUNDS_LNGLAT = [
  [-73.6, -55.5],
  [-53.5, -21.5],
]
const MAX_BOUNDS_LNGLAT = [
  [-100, -70],
  [-25, -5],
]

function createDot(bg, border) {
  const el = document.createElement('div')
  el.style.width = '16px'
  el.style.height = '16px'
  el.style.borderRadius = '50%'
  el.style.background = bg
  el.style.border = `2px solid ${border}`
  el.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.2)'
  return el
}

function createActualMarkerEl(label, onMarkerClick) {
  const wrap = document.createElement('div')
  wrap.style.display = 'flex'
  wrap.style.flexDirection = 'column'
  wrap.style.alignItems = 'center'
  wrap.style.gap = '2px'

  const tag = document.createElement('div')
  tag.textContent = label
  tag.className = 'round-tooltip'
  wrap.appendChild(tag)

  if (onMarkerClick) {
    // Visible affordance that this pin does something — a plain colored dot
    // gives no hint it's tappable, especially on touch where :hover never
    // shows the cursor change.
    wrap.style.cursor = 'pointer'
    const dotWrap = document.createElement('div')
    dotWrap.style.position = 'relative'
    dotWrap.appendChild(createDot('#ef4444', '#b91c1c'))
    const badge = document.createElement('div')
    badge.textContent = '💬'
    badge.style.position = 'absolute'
    badge.style.top = '-8px'
    badge.style.right = '-10px'
    badge.style.fontSize = '13px'
    badge.style.lineHeight = '1'
    badge.style.filter = 'drop-shadow(0 1px 1px rgba(0,0,0,0.6))'
    dotWrap.appendChild(badge)
    wrap.appendChild(dotWrap)
    wrap.addEventListener('click', (e) => {
      e.stopPropagation()
      onMarkerClick()
    })
  } else {
    wrap.appendChild(createDot('#ef4444', '#b91c1c'))
  }

  return wrap
}

// onActualMarkerClick (optional): called with a round's result entry when
// its actual-location marker is clicked — used by the duel result views to
// open "Agregar comentario/sugerencia" for that localidad. Left
// undefined everywhere else (daily/practice/custom results, the live
// in-game map), so those markers stay non-interactive.
export default function ResultsMap({ results, pendingGuess, clickEnabled, onPick, onActualMarkerClick }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const pendingMarkerRef = useRef(null)
  const clickEnabledRef = useRef(clickEnabled)
  const onPickRef = useRef(onPick)
  const onActualMarkerClickRef = useRef(onActualMarkerClick)
  const [loaded, setLoaded] = useState(false)

  clickEnabledRef.current = clickEnabled
  onPickRef.current = onPick
  onActualMarkerClickRef.current = onActualMarkerClick

  useEffect(() => {
    let cancelled = false

    async function init() {
      const res = await fetch('/style.json')
      const style = await res.json()
      if (cancelled) return

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        bounds: ARGENTINA_BOUNDS_LNGLAT,
        fitBoundsOptions: { padding: 16 },
        minZoom: 1.5,
        maxZoom: 15,
      })
      map.setMaxBounds(MAX_BOUNDS_LNGLAT)
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')

      map.on('load', () => {
        if (cancelled) return
        map.addSource('guess-lines', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: 'guess-lines-halo',
          type: 'line',
          source: 'guess-lines',
          paint: { 'line-color': '#000000', 'line-width': 6, 'line-opacity': 0.35, 'line-blur': 1 },
        })
        map.addLayer({
          id: 'guess-lines-layer',
          type: 'line',
          source: 'guess-lines',
          paint: { 'line-color': '#ffffff', 'line-width': 3.5 },
        })
        setLoaded(true)
      })

      map.on('click', (e) => {
        if (!clickEnabledRef.current) return
        onPickRef.current([e.lngLat.lat, e.lngLat.lng])
      })

      mapRef.current = map
    }

    init()

    return () => {
      cancelled = true
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      pendingMarkerRef.current?.remove()
      pendingMarkerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pending guess (tapped but not yet confirmed) gets its own marker, moved
  // in place on subsequent taps rather than rebuilt alongside the confirmed
  // results markers/lines below.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    if (!pendingGuess) {
      pendingMarkerRef.current?.remove()
      pendingMarkerRef.current = null
      return
    }

    const lngLat = [pendingGuess[1], pendingGuess[0]]
    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setLngLat(lngLat)
    } else {
      pendingMarkerRef.current = new maplibregl.Marker({ element: createDot('#38bdf8', '#0284c7') })
        .setLngLat(lngLat)
        .addTo(map)
    }
  }, [pendingGuess, loaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    // A round can have no guess at all (duel timed out with no click) — show
    // just the actual-location marker for those, skip the guess marker/line.
    //
    // Optional per-entry overrides (used by DuelResultPage to overlay every
    // participant's guesses on one map): actualLabel replaces the default
    // "R{i+1}" tag, skipActualMarker omits the red actual-location pin (so
    // it's only drawn once per round instead of once per participant —
    // they'd all sit at the exact same coordinates anyway), guessColor/
    // guessBorderColor recolor that entry's guess dot per-participant.
    const features = []
    results.forEach((r, i) => {
      if (!r.skipActualMarker) {
        const actualMarker = new maplibregl.Marker({
          element: createActualMarkerEl(
            r.actualLabel ?? `R${i + 1}`,
            onActualMarkerClickRef.current ? () => onActualMarkerClickRef.current(r) : null,
          ),
          anchor: 'bottom',
        })
          .setLngLat([r.actual[1], r.actual[0]])
          .addTo(map)
        markersRef.current.push(actualMarker)
      }

      if (!r.guess) return

      const guessMarker = new maplibregl.Marker({
        element: createDot(r.guessColor ?? '#38bdf8', r.guessBorderColor ?? '#0284c7'),
      })
        .setLngLat([r.guess[1], r.guess[0]])
        .addTo(map)
      markersRef.current.push(guessMarker)

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [r.guess[1], r.guess[0]],
            [r.actual[1], r.actual[0]],
          ],
        },
        properties: {},
      })
    })

    map.getSource('guess-lines')?.setData({ type: 'FeatureCollection', features })
  }, [results, loaded])

  return <div ref={containerRef} className="map" />
}
