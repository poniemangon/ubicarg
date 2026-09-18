export default function TopBar({ onToggleSidebar }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-burger"
          onClick={onToggleSidebar}
          aria-label="Abrir menú"
        >
          ☰
        </button>
        <img src="/favicon.svg" alt="UbicaRG" className="topbar-logo" />
        <span className="topbar-title">
          ubic<span className="topbar-title-accent">ARG</span>
        </span>
      </div>
    </header>
  )
}
