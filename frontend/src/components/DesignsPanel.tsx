import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Design, FeatureName, Run } from '../types';
import { Empty, ErrorNote, SectionHead } from './ui';

const DEVICES = [
  { id: 'desktop', label: 'Desktop', width: 1280, cols: 'xl:grid-cols-2' },
  { id: 'tablet', label: 'Tablet', width: 768, cols: 'md:grid-cols-2 2xl:grid-cols-3' },
  { id: 'mobile', label: 'Mobile', width: 390, cols: 'sm:grid-cols-2 xl:grid-cols-4' },
] as const;
type Device = (typeof DEVICES)[number];

const DIRECTION: Record<Design['direction'], string> = { 'story-led': 'Story-led', 'benefit-grid': 'Benefit grid', 'social-proof': 'Proof first', 'offer-led': 'Offer-led' };
const FEATURES: { key: FeatureName; label: string; weight: number }[] = [
  { key: 'sectionOrder', label: 'Section order', weight: 25 },
  { key: 'heroType', label: 'Hero layout', weight: 20 },
  { key: 'composition', label: 'Sections used', weight: 20 },
  { key: 'visualStyle', label: 'Visual style', weight: 15 },
  { key: 'imageLayout', label: 'Image arrangement', weight: 10 },
  { key: 'atcPlacement', label: 'Add-to-cart placement', weight: 10 },
];
const REJECT_TAGS: [string, string][] = [['too_similar', 'Too similar'], ['off_brand', 'Off brand'], ['wrong_tone', 'Wrong tone'], ['weak_headline', 'Weak headline'], ['too_busy', 'Too busy'], ['too_plain', 'Too plain'], ['missing_info', 'Missing info'], ['layout', 'Layout']];

export function DesignsPanel({ run }: { run: Run }) {
  const designs = useQuery({ queryKey: ['designs', run.id], queryFn: () => api.designs(run.id) });
  const [device, setDevice] = useState<Device>(DEVICES[2]);
  const [showOld, setShowOld] = useState(false);
  const stage = run.stages.find((s) => s.stage === 'generate');
  const all = designs.data ?? [];
  const current = all.filter((d) => d.status !== 'superseded');
  const old = all.filter((d) => d.status === 'superseded');
  const list = showOld ? all : current;

  if (!all.length) {
    return <Empty title={stage?.status === 'running' ? 'Designing four proofs…' : 'No designs yet'}>{stage?.message ?? 'Designs are generated after the competitor research.'}</Empty>;
  }
  const compared = current[0]?.fingerprint?.similarity.comparedAgainst ?? 0;
  return (
    <div>
      <SectionHead
        title="Four proofs to review"
        aside={
          <div className="flex items-center gap-1 rounded-md border border-rule bg-sheet p-1" role="radiogroup" aria-label="Preview size">
            {DEVICES.map((d) => (
              <button key={d.id} role="radio" aria-checked={device.id === d.id} onClick={() => setDevice(d)} className={`rounded px-3 py-1.5 text-sm ${device.id === d.id ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}>
                {d.label} <span className="text-xs opacity-70">{d.width}</span>
              </button>
            ))}
          </div>
        }
      >
        Each design follows a different direction and is checked against {compared ? `${compared} earlier design${compared === 1 ? '' : 's'} in this category` : 'earlier designs in this category (none yet)'}. Approve the ones you would publish; rejections and their reasons steer the next run.
      </SectionHead>
      {old.length > 0 && (
        <button className="btn-ghost mb-4 px-2 text-sm" onClick={() => setShowOld((v) => !v)}>{showOld ? 'Hide earlier versions' : `Show ${old.length} earlier version${old.length === 1 ? '' : 's'}`}</button>
      )}
      <ul className={`grid gap-x-8 gap-y-14 pt-3 ${device.cols}`}>
        {list.map((d) => <ProofCard key={d.id} d={d} device={device} runId={run.id} />)}
      </ul>
    </div>
  );
}

function ScaledFrame({ src, width, title }: { src: string; width: number; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const scale = w ? w / width : 0;
  const frameH = width === 390 ? 844 : width === 768 ? 1024 : 800;
  return (
    <div ref={box} className="relative w-full overflow-hidden bg-paper" style={{ height: scale ? frameH * scale : 400 }}>
      {scale > 0 && (
        <iframe
          title={title}
          src={src}
          loading="lazy"
          // Our own sanitized, same-origin render. An opaque-origin sandbox is blocked by some embedded browsers.
          sandbox="allow-scripts allow-same-origin"
          className="absolute left-0 top-0 origin-top-left border-0 bg-white"
          style={{ width, height: frameH, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}

function ProofCard({ d, device, runId }: { d: Design; device: Device; runId: string }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [regenerating, setRegenerating] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['designs', runId] });
  const feedback = useMutation({
    mutationFn: (v: { verdict: 'approved' | 'rejected'; reason?: string; tags?: string[] }) => api.feedback(d.id, v.verdict, v.reason, v.tags),
    onSuccess: () => { setRejecting(false); refresh(); },
  });
  const regen = useMutation({ mutationFn: () => api.regenerate(d.id), onSuccess: () => setRegenerating(true) });
  const sim = d.fingerprint?.similarity;
  const near = sim?.nearestPrior;
  const sibMax = Math.max(0, ...(sim?.siblings ?? []).map((s) => s.score));
  const superseded = d.status === 'superseded';
  const unsupported = d.config.copyCheck.unsupportedNumbers;

  return (
    <li className={`flex flex-col ${superseded ? 'opacity-60' : ''}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink-2">{DIRECTION[d.direction]}{d.version > 1 ? `, version ${d.version}` : ''}</p>
          <h3 className="line-clamp-2 text-xl font-bold leading-tight">{d.name}</h3>
          <p className="text-sm text-ink-2">{d.config.label}</p>
        </div>
        <StatusTag status={d.status} />
      </div>

      <div className={`proof ${d.status === 'approved' ? 'is-approved' : ''}`}>
        <div className="overflow-hidden border border-rule bg-white">
          {d.previewUrl ? <ScaledFrame src={d.previewUrl} width={device.width} title={`${d.name}, ${device.label} preview`} /> : <div className="p-6 text-sm text-ink-2">No preview available</div>}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-2">
        <span>Local render; header and footer come from your Shopify theme</span>
        {d.previewUrl && <a className="link" href={d.previewUrl} target="_blank" rel="noreferrer">Open full page</a>}
      </div>

      {!superseded && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={feedback.isPending || d.status === 'approved'} onClick={() => feedback.mutate({ verdict: 'approved' })}>{d.status === 'approved' ? 'Approved' : 'Approve'}</button>
          <button className="btn-quiet" disabled={feedback.isPending} onClick={() => setRejecting((v) => !v)} aria-expanded={rejecting}>{d.status === 'rejected' ? 'Rejected' : 'Reject'}</button>
          <button className="btn-ghost" disabled={regen.isPending || regenerating} onClick={() => regen.mutate()}>{regenerating || regen.isPending ? 'Regenerating…' : 'Regenerate this design'}</button>
        </div>
      )}
      {rejecting && (
        <form className="sheet mt-3 p-4" onSubmit={(e) => { e.preventDefault(); feedback.mutate({ verdict: 'rejected', reason: reason.trim() || undefined, tags }); }}>
          <p className="label">What is wrong with it? (optional, used to steer future designs)</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REJECT_TAGS.map(([id, label]) => {
              const on = tags.includes(id);
              return <button key={id} type="button" aria-pressed={on} onClick={() => setTags((t) => (on ? t.filter((x) => x !== id) : [...t, id]))} className={`rounded-full border px-2.5 py-0.5 text-sm ${on ? 'border-ink bg-ink text-white' : 'border-rule text-ink-2'}`}>{label}</button>;
            })}
          </div>
          <textarea className="field mt-3" rows={2} maxLength={500} placeholder="For example: the headline promises more than the product does" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-2 flex gap-2"><button className="btn-ink">Reject design</button><button type="button" className="btn-ghost" onClick={() => setRejecting(false)}>Cancel</button></div>
        </form>
      )}
      {(feedback.error || regen.error) && <div className="mt-2"><ErrorNote>{((feedback.error || regen.error) as Error).message}</ErrorNote></div>}
      {d.feedback[0]?.reason && <p className="mt-2 text-sm text-ink-2">Your note: {d.feedback[0].reason}</p>}

      <div className="mt-5 space-y-5 border-t border-rule pt-4 text-sm">
        {d.config.config.rationale && <p>{d.config.config.rationale}</p>}

        {sim && (
          <div>
            <p className="font-medium">{sim.verdict === 'distinct' ? 'Different from earlier designs' : sim.verdict === 'similar' ? 'Close to an earlier design' : 'First design in this category'}</p>
            {near ? (
              <>
                <SimilarityBar score={near.score} threshold={sim.threshold} />
                <p className="mt-1 text-xs text-ink-2">Nearest earlier design: {near.designName ?? 'unnamed'}. 0% means nothing in common, 100% identical under this check. Below {Math.round(sim.threshold * 100)}% counts as different. This is a heuristic, not a guarantee.</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-ink-2 hover:text-ink">What is shared, by feature</summary>
                  <ul className="mt-2 space-y-1.5">
                    {FEATURES.map((f) => (
                      <li key={f.key} className="grid grid-cols-[150px_minmax(0,1fr)_40px] items-center gap-2 text-xs">
                        <span className="text-ink-2">{f.label} <span className="text-ink-3">({f.weight}%)</span></span>
                        <span className="relative h-1.5 overflow-hidden rounded-full bg-paper"><span className="absolute inset-y-0 left-0 bg-ink-2" style={{ width: `${Math.round((near.features[f.key] ?? 0) * 100)}%` }} /></span>
                        <span className="text-right">{Math.round((near.features[f.key] ?? 0) * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : <p className="text-xs text-ink-2">Nothing to compare with yet. Later runs in this category will be checked against this one.</p>}
            {sim.siblings?.length ? <p className="mt-1 text-xs text-ink-2">Most similar design in this run: {Math.round(sibMax * 100)}%.</p> : null}
          </div>
        )}

        {d.config.appliedLearnings.length > 0 && (
          <div>
            <p className="font-medium">Shaped by competitor research</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">{d.config.appliedLearnings.map((a) => <li key={a.key}>{a.how}</li>)}</ul>
          </div>
        )}
        {(d.config.dataNotes.length > 0 || unsupported.length > 0) && (
          <div>
            <p className="font-medium">Notes</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
              {d.config.dataNotes.map((n) => <li key={n}>{n}</li>)}
              {unsupported.length > 0 && <li className="text-warn">Check these figures against the product: {unsupported.join(', ')}</li>}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

function SimilarityBar({ score, threshold }: { score: number; threshold: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="relative h-2 flex-1 rounded-full bg-paper" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Similarity to nearest earlier design">
        <span className={`absolute inset-y-0 left-0 rounded-full ${score >= threshold ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
        <span className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: `${threshold * 100}%` }} title={`Threshold ${Math.round(threshold * 100)}%`} />
      </div>
      <span className="w-12 text-right font-display text-lg font-bold">{pct}%</span>
    </div>
  );
}

function StatusTag({ status }: { status: Design['status'] }) {
  const map = { draft: ['Awaiting review', 'bg-paper text-ink-2'], approved: ['Approved', 'bg-magenta text-white'], rejected: ['Rejected', 'bg-bad-soft text-bad'], superseded: ['Replaced', 'bg-paper text-ink-3'] } as const;
  const [label, cls] = map[status];
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
