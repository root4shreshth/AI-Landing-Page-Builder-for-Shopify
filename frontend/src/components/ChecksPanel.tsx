import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, timeAgo } from '../api';
import type { CheckItem, CheckStatus, Deployment, Design, DesignChecks, Run } from '../types';
import { Empty, ErrorNote, SectionHead } from './ui';

const STATUS: Record<CheckStatus, { label: string; cls: string; mark: string }> = {
  passed: { label: 'Passed', cls: 'text-ok', mark: '✓' },
  failed: { label: 'Failed', cls: 'text-bad', mark: '✕' },
  needs_verification: { label: 'Needs verification', cls: 'text-warn', mark: '?' },
  not_applicable: { label: 'Not applicable', cls: 'text-ink-3', mark: '–' },
};
const AREAS = [['seo', 'SEO'], ['aeo', 'AEO'], ['geo', 'GEO'], ['schema', 'Structured data']] as const;
const LH_TARGETS: [keyof Extract<DesignChecks['lighthouse'], { scores: unknown }>['scores'], string, number][] = [['performance', 'Performance', 85], ['accessibility', 'Accessibility', 90], ['seo', 'SEO', 95], ['best-practices', 'Best practices', 90]];

export function ChecksPanel({ run }: { run: Run }) {
  const designs = useQuery({ queryKey: ['designs', run.id], queryFn: () => api.designs(run.id) });
  const current = (designs.data ?? []).filter((d) => d.status !== 'superseded');
  const stage = run.stages.find((s) => s.stage === 'validate');
  const qc = useQueryClient();
  const [lighthouse, setLighthouse] = useState(true);
  const start = useMutation({ mutationFn: () => api.runChecks(run.id, lighthouse), onSuccess: () => qc.invalidateQueries({ queryKey: ['run', run.id] }) });
  const runningChecks = stage?.status === 'running';

  if (!current.length) return <Empty title="Nothing to check yet">Checks run on the generated designs.</Empty>;
  return (
    <div className="space-y-14">
      <section>
        <SectionHead
          title="Quality checks"
          aside={
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={lighthouse} onChange={(e) => setLighthouse(e.target.checked)} className="accent-[var(--magenta)]" />Include Lighthouse (about 30 s per design)</label>
              <button className="btn-ink" disabled={runningChecks || start.isPending} onClick={() => start.mutate()}>{runningChecks ? 'Checking…' : current.some((d) => d.checks) ? 'Run checks again' : 'Run checks'}</button>
            </div>
          }
        >
          Measured on each design's rendered page: SEO, answer-engine and AI-search readiness, structured data, real-browser layout and cart behaviour, and Lighthouse on mobile. Scores only count checks that actually ran.
        </SectionHead>
        {stage?.message && <p className={`mb-4 text-sm ${stage.status === 'failed' ? 'text-bad' : 'text-ink-2'}`}>{stage.message}</p>}
        {start.error && <ErrorNote>{(start.error as Error).message}</ErrorNote>}
        <ul className="space-y-6">{current.map((d) => <DesignChecksCard key={d.id} d={d} />)}</ul>
      </section>
      <PublishSection run={run} designs={current} />
    </div>
  );
}

function ScoreTile({ label, value, target, sub }: { label: string; value: number | null; target?: number; sub?: string }) {
  const tone = value == null ? 'text-ink-3' : target == null ? 'text-ink' : value >= target ? 'text-ok' : 'text-bad';
  return (
    <div className="min-w-[96px]">
      <p className="text-xs text-ink-2">{label}</p>
      <p className={`font-display text-2xl font-bold ${tone}`}>{value ?? '—'}</p>
      {sub && <p className="text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}

function DesignChecksCard({ d }: { d: Design }) {
  const c = d.checks;
  const lh = c && 'scores' in c.lighthouse ? c.lighthouse : null;
  const browser = c && !('error' in c.browser) ? c.browser : null;
  return (
    <li className="sheet p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">{d.name}</h3>
        <span className="text-sm text-ink-2">{c ? `Checked ${timeAgo(c.ranAt)}` : 'Not checked yet'}</span>
      </div>
      {!c ? <p className="mt-2 text-sm text-ink-2">Run the checks to see results for this design.</p> : (
        <>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div>
              <p className="label">Checklist score (passed of passed + failed)</p>
              <div className="mt-2 flex flex-wrap gap-6">
                {AREAS.map(([k, label]) => {
                  const s = c.checklist.scores[k];
                  return <ScoreTile key={k} label={label} value={s.score} target={k === 'seo' ? 95 : 80} sub={`${s.passed}/${s.passed + s.failed} passed`} />;
                })}
              </div>
            </div>
            <div>
              <p className="label">Lighthouse, mobile {lh ? '(local render, without your theme)' : ''}</p>
              {lh ? (
                <div className="mt-2 flex flex-wrap gap-6">{LH_TARGETS.map(([k, label, t]) => <ScoreTile key={k} label={label} value={lh.scores[k]} target={t} sub={`target ${t}+`} />)}</div>
              ) : <p className="mt-2 text-sm text-ink-2">{'note' in c.lighthouse ? c.lighthouse.note : 'Not run'}</p>}
              {lh && <p className="mt-1 text-xs text-ink-2">LCP {lh.metrics.lcpMs != null ? `${(lh.metrics.lcpMs / 1000).toFixed(1)} s` : '—'}, CLS {lh.metrics.cls ?? '—'}, TBT {lh.metrics.tbtMs ?? '—'} ms. Scores on Shopify include your theme's header, footer and scripts.{lh.reportFile && <> <a className="link" href={lh.reportFile} target="_blank" rel="noreferrer">Full Lighthouse report</a></>}</p>}
            </div>
          </div>

          {browser ? (
            <div className="mt-6">
              <p className="label">In a real browser</p>
              <div className="mt-2 grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
                <div className="flex gap-3">
                  {browser.widths.map((w) => (
                    <a key={w.width} href={w.screenshot} target="_blank" rel="noreferrer" className="block text-center text-xs text-ink-2">
                      <img src={w.screenshot} alt={`Screenshot at ${w.width}px`} className="h-28 w-auto rounded border border-rule object-cover object-top" loading="lazy" />
                      <span className={w.overflowPx === 0 && w.h1Count === 1 ? 'text-ok' : 'text-bad'}>{w.width}px {w.overflowPx === 0 ? 'fits' : `overflows ${w.overflowPx}px`}</span>
                    </a>
                  ))}
                </div>
                <ul className="space-y-1.5 text-sm">
                  <Row ok={browser.atcFirstScreen.passed} text={`Add-to-cart on the first ${browser.atcFirstScreen.viewport} screen${browser.atcFirstScreen.bottomPx != null ? ` (bottom at ${browser.atcFirstScreen.bottomPx}px)` : ''}`} />
                  <Row ok={browser.sticky.passed} text={`Sticky add-to-cart: ${browser.sticky.detail}`} />
                  <Row ok={browser.cart.passed} text={`Cart: ${browser.cart.detail}. Previews simulate the Shopify cart; the live cart is tested on the Shopify preview.`} />
                  <Row ok={!browser.jsErrors.length} text={browser.jsErrors.length ? `JavaScript errors: ${browser.jsErrors.join('; ')}` : 'No JavaScript errors'} />
                </ul>
              </div>
            </div>
          ) : c && 'error' in c.browser ? <p className="mt-4 text-sm text-bad">Browser checks failed: {c.browser.error}</p> : null}

          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-medium">All {c.checklist.items.length} checklist items</summary>
            <div className="mt-3 grid gap-x-8 gap-y-4 md:grid-cols-2">
              {AREAS.map(([k, label]) => (
                <div key={k}>
                  <p className="font-display font-bold">{label}</p>
                  <ul className="mt-1 divide-y divide-rule text-sm">{c.checklist.items.filter((i) => i.area === k).map((i) => <ChecklistRow key={i.id} i={i} />)}</ul>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </li>
  );
}

function Row({ ok, text }: { ok: boolean; text: string }) {
  return <li className="flex gap-2"><span className={ok ? 'text-ok' : 'text-bad'} aria-hidden="true">{ok ? '✓' : '✕'}</span><span>{text}<span className="sr-only">{ok ? ' (passed)' : ' (failed)'}</span></span></li>;
}

function ChecklistRow({ i }: { i: CheckItem }) {
  const s = STATUS[i.status];
  return (
    <li className="flex gap-2 py-1.5">
      <span className={`w-4 shrink-0 font-semibold ${s.cls}`} aria-hidden="true">{s.mark}</span>
      <span className="min-w-0"><span className="font-medium">{i.label}</span> <span className={`text-xs ${s.cls}`}>{s.label}</span><span className="block text-xs text-ink-2">{i.detail}</span></span>
    </li>
  );
}

// ------------------------------------------------------------------------------------------------
function PublishSection({ run, designs }: { run: Run; designs: Design[] }) {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['publish', run.id], queryFn: () => api.publishInfo(run.id) });
  const approved = designs.filter((d) => d.status === 'approved');
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => setSelected((approved.length ? approved : designs.filter((d) => d.status !== 'rejected')).map((d) => d.id)), [designs.map((d) => d.id + d.status).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const pkg = useMutation({ mutationFn: () => api.buildPackage(run.id, selected), onSuccess: () => qc.invalidateQueries({ queryKey: ['publish', run.id] }) });
  const p = info.data?.package;
  const handle = run.product?.facts.snapshot.handle;

  return (
    <>
      <section>
        <SectionHead title="Theme package">A complete Shopify theme (Dawn plus the landing-page sections) with the selected designs as product templates. Upload it under Online Store, Themes, Add theme, Upload zip file, or deploy it below.</SectionHead>
        <div className="sheet p-5">
          <p className="label">Designs to include</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {designs.map((d) => {
              const on = selected.includes(d.id);
              return (
                <label key={d.id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${on ? 'border-ink' : 'border-rule text-ink-2'}`}>
                  <input type="checkbox" checked={on} onChange={() => setSelected((s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id]))} className="accent-[var(--magenta)]" />
                  {d.name}{d.status === 'approved' ? ' (approved)' : d.status === 'rejected' ? ' (rejected)' : ''}
                </label>
              );
            })}
          </div>
          <button className="btn-ink mt-4" disabled={!selected.length || pkg.isPending} onClick={() => pkg.mutate()}>{pkg.isPending ? 'Building theme…' : 'Build theme package'}</button>
          {pkg.error && <div className="mt-3"><ErrorNote>{(pkg.error as Error).message}</ErrorNote></div>}
          {p && (
            <div className="mt-5 grid gap-4 border-t border-rule pt-4 text-sm md:grid-cols-3">
              <div>
                <p className="font-medium">Theme ZIP</p>
                <a className="link" href={p.zipUrl} download>Download ({Math.round(p.zipBytes / 1024)} KB)</a>
                <p className="text-xs text-ink-2">Built {timeAgo(p.builtAt)} with {p.templates.length} template{p.templates.length === 1 ? '' : 's'}</p>
              </div>
              <div>
                <p className="font-medium">Shopify Theme Check</p>
                <p className={p.themeCheck.status === 'passed' ? 'text-ok' : p.themeCheck.status === 'failed' ? 'text-bad' : 'text-ink-2'}>
                  {p.themeCheck.status === 'not_run' ? 'Not run' : `${p.themeCheck.errors} errors, ${p.themeCheck.warnings} warnings`}
                </p>
                <p className="text-xs text-ink-2">{p.themeCheck.lpIssues.length ? p.themeCheck.lpIssues.join('; ') : p.themeCheck.note}</p>
              </div>
              <div>
                <p className="font-medium">Product CSV</p>
                {p.csvUrl ? <a className="link" href={p.csvUrl} download>Download product.csv</a> : '—'}
                <p className="text-xs text-ink-2">Import under Products, Import if your store doesn't have this product yet. Add-to-cart uses your store's own variant IDs.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <DeploySection run={run} designs={designs} info={info.data} handle={handle} />
    </>
  );
}

function DeploySection({ run, designs, info, handle }: { run: Run; designs: Design[]; info?: Awaited<ReturnType<typeof api.publishInfo>>; handle?: string }) {
  const qc = useQueryClient();
  const [store, setStore] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [themeId, setThemeId] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (info?.store && !store) setStore(info.store); }, [info?.store]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = info?.history.find((h) => h.status === 'succeeded' || h.status === 'partial');
  useEffect(() => { if (last?.themeId && !themeId) setThemeId(last.themeId); }, [last?.themeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const dep = useMutation({
    mutationFn: () => api.deploy(run.id, { store: store.trim(), mode, themeId: mode === 'existing' ? themeId.trim() : undefined, confirmOverwrite: true }),
    onSuccess: () => { setConfirm(false); qc.invalidateQueries({ queryKey: ['publish', run.id] }); },
    onError: () => qc.invalidateQueries({ queryKey: ['publish', run.id] }),
  });
  const err = dep.error as ApiError | null;
  const byId = new Map(designs.map((d) => [d.id, d]));

  return (
    <>
      <section>
        <SectionHead title="Deploy to Shopify">Pushes the package with Shopify CLI to an unpublished theme, so your live store is never changed. The live theme is refused as a target.</SectionHead>
        {!info?.package ? <Empty title="Build the theme package first" /> : !info.cliInstalled ? (
          <Empty title="Shopify CLI is not installed on this machine">Install it with npm install -g @shopify/cli, log in once, or upload the ZIP manually.</Empty>
        ) : (
          <form className="sheet grid gap-4 p-5 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (confirm) dep.mutate(); }}>
            <div>
              <label htmlFor="store" className="label">Store</label>
              <input id="store" className="field mt-1" placeholder="your-store.myshopify.com" value={store} onChange={(e) => setStore(e.target.value)} required />
            </div>
            <fieldset>
              <legend className="label">Target theme</legend>
              <div className="mt-1 flex flex-col gap-1.5 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} className="accent-[var(--magenta)]" />A new unpublished theme</label>
                <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === 'existing'} onChange={() => setMode('existing')} className="accent-[var(--magenta)]" />An existing unpublished theme</label>
                {mode === 'existing' && <input className="field" inputMode="numeric" placeholder="Theme ID, e.g. 167659831382" value={themeId} onChange={(e) => setThemeId(e.target.value)} aria-label="Theme ID" />}
              </div>
            </fieldset>
            <label className="flex items-start gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1 accent-[var(--magenta)]" />
              <span>I understand that files with the same names in the target theme are replaced, including edits made in the theme editor to these templates and sections. Other files are kept.</span>
            </label>
            <div className="md:col-span-2">
              <button className="btn-primary" disabled={!confirm || dep.isPending || !store}>{dep.isPending ? 'Deploying… (this can take a minute)' : 'Deploy to unpublished theme'}</button>
            </div>
            {err && <div className="md:col-span-2"><ErrorNote>{err.issues?.length ? err.issues.map((i) => i.message).join('; ') : err.message}</ErrorNote></div>}
          </form>
        )}
        {last && handle && (
          <div className="sheet mt-4 p-5">
            <p className="font-medium">Deployed to “{last.themeName}” on {last.store}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {(last.designIds as string[]).map((id) => byId.get(id)).filter((d): d is Design => !!d).map((d) => (
                <li key={d.id}><a className="link" target="_blank" rel="noreferrer" href={`https://${last.store}/products/${handle}?preview_theme_id=${last.themeId}&view=${d.templateKey}`}>Preview {d.name}</a></li>
              ))}
              {last.editorUrl && <li><a className="link" target="_blank" rel="noreferrer" href={last.editorUrl}>Open the theme editor</a></li>}
            </ul>
            <div className="mt-4 rounded-md bg-paper p-3 text-sm text-ink-2">
              <p className="font-medium text-ink">Using a design on the live product page</p>
              <p className="mt-1">Previews above work while the theme is unpublished. Shopify only lists templates from the published theme in the product editor, so once you publish this theme: open Products, choose “{run.product?.title}”, set Theme template to the design's template (it starts with <code>lp-</code>), and save. Your store's password page also applies to previews until you remove it.</p>
            </div>
          </div>
        )}
      </section>

      <section>
        <SectionHead title="Deployment history" />
        {!info?.history.length ? <p className="text-sm text-ink-2">No deployments for this run yet.</p> : <History items={info.history} />}
      </section>
    </>
  );
}

function History({ items }: { items: Deployment[] }) {
  const tone: Record<Deployment['status'], string> = { succeeded: 'text-ok', partial: 'text-warn', failed: 'text-bad', pending: 'text-ink-2' };
  return (
    <div className="sheet overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead><tr className="border-b border-rule text-left text-ink-2"><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Store</th><th className="px-4 py-2 font-medium">Theme</th><th className="px-4 py-2 font-medium">Designs</th><th className="px-4 py-2 font-medium">Result</th></tr></thead>
        <tbody>
          {items.map((h) => (
            <tr key={h.id} className="border-b border-rule last:border-0 align-top">
              <td className="px-4 py-2.5 text-ink-2">{timeAgo(h.createdAt)}</td>
              <td className="px-4 py-2.5">{h.store}</td>
              <td className="px-4 py-2.5">{h.themeName ?? '—'}{h.themeId && <span className="block text-xs text-ink-2">{h.themeId}</span>}</td>
              <td className="px-4 py-2.5">{(h.designIds as string[]).length}</td>
              <td className={`px-4 py-2.5 ${tone[h.status]}`}>{h.status}{h.log && <span className="block max-w-sm text-xs text-ink-2">{h.log}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
