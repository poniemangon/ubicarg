import { useMemo } from 'react'

// Shared by DuelSetupModal (private) and MultiplayerDuelSetupModal — both
// need the same "pick provincias, empty = cualquiera" UI.
export default function ProvinciaPicker({ provincias, selected, onToggle }) {
  const normalProvincias = useMemo(
    () => [...provincias.filter((p) => p.comuna !== 0)].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [provincias],
  )

  return (
    <>
      <div className="duel-setup-label">Provincias (vacío = cualquiera)</div>
      <div className="barrios-scroll">
        <div className="barrio-chips">
          {normalProvincias.map((p) => (
            <button
              type="button"
              key={p.provincia_id}
              className={`barrio-chip${selected.has(p.provincia_id) ? ' selected' : ''}`}
              onClick={() => onToggle(p.provincia_id)}
            >
              {p.nombre}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
