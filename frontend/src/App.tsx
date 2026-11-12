import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { HistoryPage } from './pages/History';
import { HomePage } from './pages/Home';
import { RunPage } from './pages/Run';

function TopBar() {
  const nav = ({ isActive }: { isActive: boolean }) => `px-3 py-1.5 rounded-md text-sm ${isActive ? 'bg-paper text-ink font-medium' : 'text-ink-2 hover:text-ink'}`;
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-sheet/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Landing page proofs — home">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="6" fill="var(--ink)" />
            <path d="M9 9v4M9 9h4M23 23v-4M23 23h-4" stroke="var(--magenta)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span className="font-display text-[17px] font-bold tracking-tight">Proofs</span>
          <span className="hidden text-sm text-ink-3 sm:inline">for Shopify landing pages</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1" aria-label="Main">
          <NavLink to="/" end className={nav}>New run</NavLink>
          <NavLink to="/history" className={nav}>History</NavLink>
        </nav>
      </div>
    </header>
  );
}

export function App() {
  return (
    <div className="min-h-screen">
      <TopBar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/runs/:id/*" element={<RunPage />} />
        <Route path="*" element={<main className="mx-auto max-w-3xl p-10"><h1 className="text-2xl">Page not found</h1><Link className="link" to="/">Start a new run</Link></main>} />
      </Routes>
    </div>
  );
}
