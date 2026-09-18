import { Link } from 'react-router-dom'
import RankingBoard from '../RankingBoard'
import './RankingPage.css'

export default function RankingPage() {
  return (
    <div className="ranking-page">
      <Link to="/" className="ranking-back-link">
        ← Volver
      </Link>
      <RankingBoard />
    </div>
  )
}
