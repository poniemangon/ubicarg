import RankingPreview from './RankingPreview'

export default function Dashboard({
  isSignedIn,
  onDaily,
  onPractice,
  onOpenArchive,
  onOpenCustom,
  onSpecialOnly,
  onDuel,
  onMultiplayerDuel,
  onOpenAuth,
}) {
  return (
    <div className="dashboard">
      <div className="dashboard-columns">
        <div className="dashboard-daily-card">
          <div className="dashboard-daily-eyebrow">Desafío diario</div>
          <h1 className="dashboard-daily-title">Mapa del día</h1>
          <p className="dashboard-daily-text">
            5 localidades nuevas cada día, en las mismas provincias para todos — comparala con tus amigos.
          </p>
          <button type="button" className="primary-btn dashboard-daily-btn" onClick={onDaily}>
            Jugar ahora
          </button>
        </div>

        <RankingPreview />

        <div className="dashboard-grid">
          <button type="button" className="dashboard-mode-card" onClick={onOpenArchive}>
            <span className="dashboard-mode-icon">📁</span>
            <span className="dashboard-mode-title">Archivo</span>
            <span className="dashboard-mode-desc">Desafíos diarios (modo tranqui) anteriores.</span>
          </button>
          <button type="button" className="dashboard-mode-card" onClick={onPractice}>
            <span className="dashboard-mode-icon">🎯</span>
            <span className="dashboard-mode-title">Práctica</span>
            <span className="dashboard-mode-desc">Igual que el mapa del día</span>
          </button>
          <button type="button" className="dashboard-mode-card" onClick={onOpenCustom}>
            <span className="dashboard-mode-icon">⚙️</span>
            <span className="dashboard-mode-title">Personalizada</span>
            <span className="dashboard-mode-desc">Elegí provincias específicas para jugar.</span>
          </button>
          <button type="button" className="dashboard-mode-card dashboard-mode-card-special" onClick={onSpecialOnly}>
            <span className="dashboard-mode-icon">✨</span>
            <span className="dashboard-mode-title">Especiales</span>
            <span className="dashboard-mode-desc">Solo ubicaciones únicas: monumentos, lugares históricos y más.</span>
          </button>

          {isSignedIn && (
            <>
              <button type="button" className="dashboard-mode-card" onClick={onDuel}>
                <span className="dashboard-mode-icon">🏅</span>
                <span className="dashboard-mode-title">Duelo rankeado</span>
                <span className="dashboard-mode-desc">Emparejamiento instantáneo — afecta tu ELO.</span>
              </button>
              <button type="button" className="dashboard-mode-card" onClick={onMultiplayerDuel}>
                <span className="dashboard-mode-icon">🔒</span>
                <span className="dashboard-mode-title">Duelo privado</span>
                <span className="dashboard-mode-desc">1 vs 1 con amigos o multijugador — no afecta tu ELO.</span>
              </button>
            </>
          )}

          {!isSignedIn && (
            <div className="dashboard-mode-card dashboard-signup-card">
              <span className="dashboard-mode-icon">🔓</span>
              <span className="dashboard-mode-title">Desbloqueá más</span>
              <span className="dashboard-mode-desc">
                Registrate para acceder a más modos y desafiar otros jugadores.
              </span>
              <button type="button" className="primary-btn secondary-btn dashboard-signup-card-btn" onClick={onOpenAuth}>
                Registrarme
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
