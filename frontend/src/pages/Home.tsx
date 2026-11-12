import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, timeAgo } from '../api';
import { ErrorNote, RunStatus } from '../components/ui';

const STEPS = [
  ['Read the product', 'Prices, variants, specs and only the reviews that really exist.'],
  ['Learn the brand', 'Colours, fonts, buttons and tone, each with a confidence you can correct.'],
  ['Study competitors', 'Indian D2C pages crawled politely; patterns counted, never copied.'],
  ['Propose four proofs', 'Story, benefit grid, proof and offer, checked against earlier designs.'],
];

export function HomePage() {
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [competitors, setCompetitors] = useState('');
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const create = useMutation({
    mutationFn: () => api.createRun(url.trim(), competitors.split(/\s+/).map((s) => s.trim()).filter(Boolean)),
    onSuccess: (r) => nav(`/runs/${r.id}`),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) create.mutate();
  };
  const err = create.error as ApiError | null;

  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-20 sm:px-6">
      <section className="grid gap-10 pt-12 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16 lg:pt-20">
        <div>
          <h1 className="max-w-3xl text-[clamp(34px,5vw,60px)] font-bold leading-[1.02]">Turn a product link into four landing page proofs.</h1>
          <p className="mt-4 max-w-xl text-[17px] text-ink-2">
            Paste a public product page. You will see what was learned about the product, the brand and its competitors, then review four Shopify-ready designs before anything is published.
          </p>

          <form onSubmit={submit} className="mt-8 max-w-3xl">
            <label htmlFor="url" className="label">Product page URL</label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                id="url"
                type="url"
                required
                inputMode="url"
                autoComplete="off"
                placeholder="https://yourstore.com/products/your-product"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="field h-12 flex-1 text-[15px]"
              />
              <button type="submit" className="btn-primary h-12 px-6 text-[15px]" disabled={create.isPending || !url.trim()}>
                {create.isPending ? 'Starting…' : 'Start analysis'}
              </button>
            </div>
            <button type="button" className="mt-3 text-sm text-ink-2 underline decoration-rule underline-offset-2 hover:text-ink" onClick={() => setShowCompetitors((v) => !v)} aria-expanded={showCompetitors}>
              {showCompetitors ? 'Hide competitor pages' : 'Add competitor pages you already know (optional)'}
            </button>
            {showCompetitors && (
              <div className="mt-3">
                <label htmlFor="competitors" className="label">Competitor product pages, one per line</label>
                <textarea id="competitors" rows={3} className="field mt-1.5 font-sans" placeholder={'https://competitor.in/products/similar-item'} value={competitors} onChange={(e) => setCompetitors(e.target.value)} />
                <p className="mt-1 text-xs text-ink-3">These are always included. Search adds more when a search key is configured.</p>
              </div>
            )}
            {err && <div className="mt-3"><ErrorNote>{err.issues?.length ? err.issues.map((i) => i.message).join('; ') : err.message}</ErrorNote></div>}
          </form>
        </div>

        <ol className="self-end border-l border-rule pl-6 lg:mb-2">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="relative pb-5 last:pb-0">
              <span className="absolute -left-[33px] top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-rule bg-sheet text-[10px] font-semibold text-ink-2">{i + 1}</span>
              <p className="font-medium">{t}</p>
              <p className="text-sm text-ink-2">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16" aria-labelledby="recent">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="recent" className="text-xl font-bold">Recent runs</h2>
          <Link to="/history" className="text-sm link">All runs</Link>
        </div>
        <RunsTable runs={runs.data?.slice(0, 6)} loading={runs.isLoading} />
      </section>
    </main>
  );
}

export function RunsTable({ runs, loading }: { runs?: Awaited<ReturnType<typeof api.runs>>; loading?: boolean }) {
  if (loading) return <div className="sheet h-32 animate-pulse" />;
  if (!runs?.length) return <p className="text-sm text-ink-2">No runs yet. Paste a product link above to start the first one.</p>;
  return (
    <div className="sheet overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-ink-2">
            <th className="px-4 py-2.5 font-medium">Product</th>
            <th className="px-4 py-2.5 font-medium">Brand</th>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Designs</th>
            <th className="px-4 py-2.5 text-right font-medium">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-rule last:border-0 hover:bg-paper/60">
              <td className="max-w-[320px] px-4 py-3">
                <Link to={`/runs/${r.id}`} className="font-medium hover:underline">{r.product?.title ?? new URL(r.inputUrl).pathname.split('/').pop()}</Link>
              </td>
              <td className="px-4 py-3 text-ink-2">{r.product?.brand.name ?? new URL(r.inputUrl).hostname}</td>
              <td className="px-4 py-3 text-ink-2">{r.product?.category ?? '—'}</td>
              <td className="px-4 py-3"><RunStatus status={r.status} /></td>
              <td className="px-4 py-3 text-right">{r._count.designs || '—'}</td>
              <td className="px-4 py-3 text-right text-ink-2">{timeAgo(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
