import { useMemo, useState } from 'react'

export default function CustomGamePicker({ provincias, provinciaCounts, onStart, onClose }) {
  // Special (comuna 0) locations get their own dedicated "solo especiales"
  // entry point in the menu, so they're excluded from this picker entirely.
  const normalProvincias = useMemo(
    () => [...provincias.filter((p) => p.comuna !== 0)].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [provincias],
  )

  const [selected, setSelected] = useState(() => new Set())

  const toggleProvincia = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = selected.size === normalProvincias.length
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(normalProvincias.map((p) => p.provincia_id)))
  }

  const availableCount = normalProvincias.reduce(
    (sum, p) => (selected.has(p.provincia_id) ? sum + (provinciaCounts.get(p.provincia_id) || 0) : sum),
    0,
  )
  const canStart = availableCount >= 5

  return (
    <div className="custom-modal">
      <div className="custom-modal-header">
        <span>Partida personalizada</span>
        <button type="button" className="calendar-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <button type="button" className="deselect-all-btn" onClick={toggleAll}>
        {allSelected ? 'Destildar todas las provincias' : 'Seleccionar todas las provincias'}
      </button>

      <div className="barrios-scroll">
        <div className="barrio-chips">
          {normalProvincias.map((p) => (
            <button
              type="button"
              key={p.provincia_id}
              className={`barrio-chip${selected.has(p.provincia_id) ? ' selected' : ''}`}
              onClick={() => toggleProvincia(p.provincia_id)}
            >
              {p.nombre}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="primary-btn start-custom-btn"
        disabled={!canStart}
        onClick={() => onStart([...selected])}
      >
        {canStart ? 'Comenzar' : 'Elegí al menos una provincia para comenzar'}
      </button>
    </div>
  )
}
