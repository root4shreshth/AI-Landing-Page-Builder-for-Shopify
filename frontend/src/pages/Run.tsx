import { useQuery } from '@tanstack/react-query';
import { NavLink, Route, Routes, useParams } from 'react-router-dom';
import { api, timeAgo } from '../api';
import { BrandPanel } from '../components/BrandPanel';
import { ChecksPanel } from '../components/ChecksPanel';
import { CompetitorsPanel } from '../components/CompetitorsPanel';
import { DesignsPanel } from '../components/DesignsPanel';
import { OverviewPanel } from '../components/OverviewPanel';
import { ErrorNote, RunStatus, StageIcon } from '../components/ui';
import type { Run } from '../types';
import { useRunEvents } from '../useRunEvents';

const TABS = [
  { path: '', label: 'Product', stages: ['product'] },
  { path: 'brand', label: 'Brand', stages: ['brand', 'tone'] },
  { path: 'competitors', label: 'Competitors', stages: ['competitors', 'learnings'] },
  { path: 'designs', label: 'Designs', stages: ['generate'] },
  { path: 'checks', label: 'Checks & publish', stages: ['validate'] },
];
const tabFor = (stage: string) => TABS.find((t) => t.stages.includes(stage))?.path ?? '';

function Rail({ run }: { run: Run }) {
  return (
    <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-0 lg:overflow-visible" aria-label="Pipeline">
      {run.pipeline.map((p, i) => {
        const s = run.stages.find((x) => x.stage === p.stage);
        const status = s?.status ?? 'pending';
        return (
          <li key={p.stage} className="min-w-[200px] lg:min-w-0">
            <NavLink to={tabFor(p.stage)} end className={({ isActive }) => `group relative flex gap-3 rounded-md px-2.5 py-2.5 lg:pb-4 ${isActive ? 'bg-sheet shadow-[inset_2px_0_0_var(--magenta)]' : 'hover:bg-sheet/70'}`}>
              {i < run.pipeline.length - 1 && <span className="absolute left-[21px] top-9 hidden h-[calc(100%-26px)] w-px bg-rule lg:block" aria-hidden="true" />}
              <StageIcon status={status} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{i + 1}. {p.label}</span>
                <span className={`block text-xs leading-snug ${status === 'failed' ? 'text-bad' : 'text-ink-2'} line-clamp-3`}>{s?.message ?? (status === 'pending' ? 'Not run yet' : '')}</span>
              </span>
            </NavLink>
          </li>
        );
      })}
    </ol>
  );
}

export function RunPage() {
  const { id } = useParams();
  const events = useRunEvents(id);
  const run = useQuery({ queryKey: ['run', id], queryFn: () => api.run(id!), refetchInterval: (q) => (['queued', 'running'].includes(q.state.data?.status ?? '') ? 4000 : false) });

  if (run.isLoading) return <main className="mx-auto max-w-[1440px] p-6"><div className="sheet h-40 animate-pulse" /></main>;
  if (run.error || !run.data) return <main className="mx-auto max-w-3xl p-6"><ErrorNote>Could not load this run: {(run.error as Error)?.message}</ErrorNote></main>;
  const r = run.data;
  const p = r.product;
  const img = p?.facts.snapshot.images[0]?.src;

  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-20 pt-6 sm:px-6">
      <header className="flex flex-wrap items-start gap-4 border-b border-rule pb-5">
        {img ? <img src={img} alt="" className="h-16 w-16 rounded-md border border-rule object-cover" /> : <span className="h-16 w-16 rounded-md border border-dashed border-rule" />}
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-bold leading-tight sm:text-[26px]">{p?.title ?? 'Analysing product…'}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            <a href={r.inputUrl} target="_blank" rel="noreferrer noopener" className="link max-w-[420px] truncate">{new URL(r.inputUrl).hostname}{new URL(r.inputUrl).pathname}</a>
            {p?.category && <span className="chip">{p.category}</span>}
            <span>Started {timeAgo(r.createdAt)}</span>
            {r.cost && <span title={r.cost.entries.map((e) => `${e.step}: $${e.usd.toFixed(4)}`).join('\n')}>AI cost ${r.cost.usd.toFixed(4)}</span>}
          </p>
        </div>
        <RunStatus status={r.status} />
      </header>
      {r.error && <div className="mt-4"><ErrorNote>{r.error}</ErrorNote></div>}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start"><Rail run={r} /></aside>
        <section className="min-w-0">
          <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-rule" aria-label="Run sections">
            {TABS.map((t) => (
              <NavLink key={t.label} to={t.path} end className={({ isActive }) => `whitespace-nowrap border-b-2 px-3 pb-2.5 text-sm ${isActive ? 'border-magenta font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>{t.label}</NavLink>
            ))}
          </nav>
          <Routes>
            <Route index element={<OverviewPanel run={r} events={events} />} />
            <Route path="brand" element={<BrandPanel run={r} />} />
            <Route path="competitors" element={<CompetitorsPanel run={r} />} />
            <Route path="designs" element={<DesignsPanel run={r} />} />
            <Route path="checks" element={<ChecksPanel run={r} />} />
          </Routes>
        </section>
      </div>
    </main>
  );
}
