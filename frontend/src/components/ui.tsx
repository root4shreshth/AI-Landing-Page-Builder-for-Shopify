import type { ReactNode } from 'react';
import type { FieldConfidence, StageStatus } from '../types';

const RUN_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'ink' | 'run' }> = {
  queued: { label: 'Queued', tone: 'ink' },
  running: { label: 'Working', tone: 'run' },
  analyzed: { label: 'Analysed', tone: 'run' },
  researched: { label: 'Researched', tone: 'warn' },
  generated: { label: 'Designs ready', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
};

const TONE_CLASS = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  ink: 'bg-paper text-ink-2',
  run: 'bg-magenta-soft text-magenta',
};

export function RunStatus({ status }: { status: string }) {
  const s = RUN_STATUS[status] ?? { label: status, tone: 'ink' as const };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[s.tone]}`}>
      {s.tone === 'run' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}
      {s.label}
    </span>
  );
}

export function StageIcon({ status }: { status: StageStatus }) {
  const base = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold';
  if (status === 'done') return <span className={`${base} bg-ok text-white`} aria-label="Done">✓</span>;
  if (status === 'failed') return <span className={`${base} bg-bad text-white`} aria-label="Failed">!</span>;
  if (status === 'skipped') return <span className={`${base} border border-rule text-ink-3`} aria-label="Skipped">–</span>;
  if (status === 'running') return <span className={`${base} border-2 border-magenta`} aria-label="Running"><span className="h-2 w-2 animate-pulse rounded-full bg-magenta" /></span>;
  return <span className={`${base} border border-dashed border-ink-3`} aria-label="Not run yet" />;
}

/** Confidence as a small meter + source; user-edited fields read "Set by you". */
export function Confidence({ c }: { c?: FieldConfidence }) {
  if (!c) return null;
  if (c.source === 'user') return <span className="text-xs font-medium text-ok">Set by you</span>;
  const pct = Math.round(c.value * 100);
  const tone = c.value >= 0.75 ? 'bg-ok' : c.value >= 0.5 ? 'bg-warn' : 'bg-bad';
  const src: Record<string, string> = { css: 'from page CSS', screenshot: 'from screenshot', 'css+screenshot': 'CSS + screenshot agree', llm: 'AI judgement', heuristic: 'best guess', default: 'default' };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2" title={c.note ?? ''}>
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-paper" aria-hidden="true">
        <span className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      {pct}%, {src[c.source] ?? c.source}
    </span>
  );
}

export function SectionHead({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-2xl">
        <h2 className="text-xl font-bold">{title}</h2>
        {children && <p className="mt-1 text-sm text-ink-2">{children}</p>}
      </div>
      {aside}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-sheet border border-dashed border-rule bg-sheet/60 px-6 py-10 text-center">
      <p className="font-display text-lg font-bold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{children}</div>;
}

export function Swatch({ hex, size = 28 }: { hex: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-md border border-black/10" style={{ background: hex, width: size, height: size }} aria-hidden="true" />;
}
