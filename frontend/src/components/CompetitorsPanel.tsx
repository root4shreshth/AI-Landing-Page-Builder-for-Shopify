import { useQuery } from '@tanstack/react-query';
import { api, fileUrl } from '../api';
import type { Competitor, Learning, Run } from '../types';
import { Empty, SectionHead } from './ui';

const GROUPS: { kind: Learning['kind']; title: string; note: string }[] = [
  { kind: 'common', title: 'Most pages do this', note: 'Shared by 60% or more of the pages we could read.' },
  { kind: 'differentiator', title: 'Some pages do this', note: 'A real choice between brands, so a chance to stand out.' },
  { kind: 'rare', title: 'Few pages do this', note: 'Uncommon among competitors.' },
];
const CHECK_LABELS: Record<string, string> = {
  atc_above_fold_mobile: 'Add-to-cart on first mobile screen', sticky_atc_mobile: 'Sticky add-to-cart (mobile)', repeated_atc: 'Add-to-cart repeated', rating_near_price: 'Rating next to price',
  reviews_section: 'Reviews section', compare_at_shown: 'Strike-through price', discount_badge: '% off badge', emi_shown: 'EMI near price', faq_section: 'FAQ', comparison_table: 'Comparison table',
  specs_table: 'Specs table', benefit_icon_grid: 'Icon benefit grid', video: 'Video', ugc: 'Customer photos', urgency: 'Urgency messaging', bundle_offer: 'Bundles / combos', cod_mentioned: 'COD mentioned',
  delivery_estimate: 'Delivery estimate', returns_mentioned: 'Returns policy', trust_near_atc: 'Trust points at add-to-cart', size_guide: 'Size guide', story_section: 'Story section',
};
const STATUS: Record<string, { label: string; cls: string }> = {
  crawled: { label: 'Crawled', cls: 'text-ok' },
  pending: { label: 'Waiting', cls: 'text-ink-2' },
  blocked_robots: { label: 'Blocked by robots.txt', cls: 'text-warn' },
  failed: { label: 'Could not load', cls: 'text-bad' },
};

export function CompetitorsPanel({ run }: { run: Run }) {
  const comps = useQuery({ queryKey: ['competitors', run.id], queryFn: () => api.competitors(run.id) });
  const learnings = useQuery({ queryKey: ['learnings', run.id], queryFn: () => api.learnings(run.id) });
  const stage = run.stages.find((s) => s.stage === 'competitors');
  const crawled = comps.data?.filter((c) => c.crawlStatus === 'crawled').length ?? 0;
  const byId = new Map((comps.data ?? []).map((c) => [c.id, c]));

  if (!comps.data?.length) {
    return <Empty title={stage?.status === 'running' ? 'Looking for competitor pages…' : 'No competitor pages yet'}>{stage?.message ?? 'Competitor research starts after the brand analysis.'}</Empty>;
  }
  return (
    <div className="space-y-12">
      <section>
        <SectionHead title="What competitors do">
          Counted by code from {crawled} page{crawled === 1 ? '' : 's'} we could read. These are observations, not proof that a pattern sells more; the designs use them where your real data allows.
        </SectionHead>
        {crawled < 8 && stage?.message && <p className="mb-4 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">{stage.message}</p>}
        {!learnings.data?.length ? <Empty title="No learnings yet" /> : (
          <div className="space-y-8">
            {GROUPS.map((g) => {
              const items = learnings.data.filter((l) => l.kind === g.kind && !l.key.startsWith('section_'));
              if (!items.length) return null;
              return (
                <div key={g.kind}>
                  <h3 className="font-display text-lg font-bold">{g.title}</h3>
                  <p className="text-sm text-ink-2">{g.note}</p>
                  <ul className="mt-3 grid gap-3 lg:grid-cols-2">{items.map((l) => <LearningCard key={l.id} l={l} byId={byId} />)}</ul>
                </div>
              );
            })}
            <SectionOrder learnings={learnings.data} />
          </div>
        )}
      </section>

      <section>
        <SectionHead title="Pages we studied">Why each page was picked, what we measured and the screenshot it was measured on. Copy and images are never reused.</SectionHead>
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {comps.data.map((c) => <CompetitorCard key={c.id} c={c} />)}
        </ul>
      </section>
    </div>
  );
}

function LearningCard({ l, byId }: { l: Learning; byId: Map<string, Competitor> }) {
  const pct = Math.round(l.share * 100);
  const [count, ...rest] = l.statement.split(': ');
  const title = rest.join(': ') || l.statement;
  return (
    <li className="sheet p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title.charAt(0).toUpperCase() + title.slice(1)}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="relative h-1.5 w-28 overflow-hidden rounded-full bg-paper" aria-hidden="true"><span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${pct}%` }} /></span>
            <span className="text-xs text-ink-2">{count}</span>
          </div>
        </div>
      </div>
      {l.recommendation && <p className="mt-3 text-sm"><span className="font-medium">What we do with it: </span>{l.recommendation}</p>}
      {l.hypothesis && <p className="mt-1 text-xs text-ink-2">{l.hypothesis}</p>}
      {l.sources.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-1.5">
          {l.sources.map((s) => (
            <a key={s.competitorId} href={`#c-${s.competitorId}`} className="chip hover:border-ink-3" title={byId.get(s.competitorId)?.url ?? s.url}>{s.domain}</a>
          ))}
        </p>
      )}
    </li>
  );
}

function SectionOrder({ learnings }: { learnings: Learning[] }) {
  const items = learnings.filter((l) => l.key.startsWith('section_'));
  if (!items.length) return null;
  return (
    <div>
      <h3 className="font-display text-lg font-bold">Where sections usually sit</h3>
      <ul className="mt-2 space-y-1 text-sm">{items.map((l) => <li key={l.id}>{l.statement}</li>)}</ul>
    </div>
  );
}

function CompetitorCard({ c }: { c: Competitor }) {
  const st = STATUS[c.crawlStatus] ?? { label: c.crawlStatus, cls: 'text-ink-2' };
  const shot = fileUrl(c.screenshots?.mobile);
  const desktop = fileUrl(c.screenshots?.desktop);
  const yes = c.findings.filter((f) => f.value).length;
  const source = c.structure?.source === 'manual' ? 'Added by you' : c.rationale?.startsWith('Starter list') ? 'Starter list' : 'Search';
  return (
    <li id={`c-${c.id}`} className="sheet flex scroll-mt-24 flex-col overflow-hidden">
      <div className="flex gap-4 p-4">
        <div className="h-44 w-24 shrink-0 overflow-hidden rounded border border-rule bg-paper">
          {shot ? <img src={shot} alt={`Mobile screenshot of ${c.domain}`} className="w-full object-cover object-top" loading="lazy" /> : <span className="flex h-full items-center justify-center px-2 text-center text-xs text-ink-3">No screenshot</span>}
        </div>
        <div className="min-w-0 flex-1">
          <a href={c.url} target="_blank" rel="noreferrer noopener" className="font-display text-base font-bold hover:underline">{c.domain}</a>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
            <span className={st.cls}>{st.label}</span>
            <span className="text-ink-2">{source}</span>
            {c.isIndianD2C && <span className="text-ink-2">Indian D2C</span>}
            {c.relevance != null && <span className="text-ink-2">Relevance {Math.round(c.relevance * 100)}%</span>}
          </p>
          <p className="mt-2 line-clamp-3 text-sm text-ink-2">{c.rationale}</p>
          {c.crawlError && <p className="mt-1 text-sm text-bad">{c.crawlError}</p>}
          {c.structure?.sectionOrder && (
            <p className="mt-2 flex flex-wrap gap-1">{c.structure.sectionOrder.map((s, i) => <span key={`${s}-${i}`} className="chip">{s}</span>)}</p>
          )}
        </div>
      </div>
      {c.findings.length > 0 && (
        <details className="mt-auto border-t border-rule">
          <summary className="cursor-pointer px-4 py-2.5 text-sm text-ink-2 hover:text-ink">{yes} of {c.findings.length} patterns present{desktop ? '' : ''}</summary>
          <ul className="grid gap-x-4 px-4 pb-4 text-sm sm:grid-cols-2">
            {c.findings.map((f) => (
              <li key={f.id} className="flex gap-2 py-0.5" title={f.evidence ?? ''}>
                <span className={f.value ? 'text-ok' : 'text-ink-3'} aria-hidden="true">{f.value ? '●' : '○'}</span>
                <span className={f.value ? '' : 'text-ink-3'}>{CHECK_LABELS[f.feature] ?? f.feature}<span className="sr-only">{f.value ? ': yes' : ': no'}</span></span>
              </li>
            ))}
          </ul>
          {desktop && <a href={desktop} target="_blank" rel="noreferrer" className="link mx-4 mb-4 inline-block text-sm">Open desktop screenshot</a>}
        </details>
      )}
    </li>
  );
}
