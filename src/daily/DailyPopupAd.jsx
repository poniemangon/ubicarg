import { incrementDailyPopupClick } from './dailyPopupApi'
import './DailyPopupAd.css'

// Desktop/mobile picked purely via CSS media query (not JS width checks)
// so it stays correct if the viewport is resized while the popup is open.
export default function DailyPopupAd({ popup, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="daily-popup-ad" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="calendar-close daily-popup-ad-close" onClick={onClose}>
          ✕
        </button>
        <div className="daily-popup-ad-inner">
          <a
            href={popup.link_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              incrementDailyPopupClick(popup.id)
              onClose()
            }}
          >
            <img src={popup.image_url_desktop} alt="" className="daily-popup-ad-image daily-popup-ad-image-desktop" />
            <img src={popup.image_url_mobile} alt="" className="daily-popup-ad-image daily-popup-ad-image-mobile" />
          </a>
        </div>
      </div>
    </div>
  )
}
