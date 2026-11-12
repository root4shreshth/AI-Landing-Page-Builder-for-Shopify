import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { BrandProfile, Run } from '../types';
import { Confidence, Empty, ErrorNote, SectionHead, Swatch } from './ui';

const TONES = ['premium', 'minimal', 'playful', 'bold', 'warm', 'technical', 'eco-conscious', 'youthful', 'luxury', 'friendly', 'clinical', 'rugged', 'traditional', 'edgy'];
const IMAGE_STYLES = ['studio-white', 'lifestyle', 'flat-lay', 'editorial', 'model-on-figure', 'product-closeups', 'illustrative', 'mixed', 'unknown'];
const COLOR_FIELDS: { key: keyof BrandProfile['colors']; label: string; hint: string }[] = [
  { key: 'primary', label: 'Primary', hint: 'Main brand colour, used for accents' },
  { key: 'secondary', label: 'Secondary', hint: 'Second colour for tinted sections' },
  { key: 'background', label: 'Background', hint: 'Page background' },
  { key: 'text', label: 'Text', hint: 'Body text' },
  { key: 'button', label: 'Button', hint: 'Add-to-cart button' },
  { key: 'buttonText', label: 'Button text', hint: 'Label on the button' },
];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Load the selected Google font families so the specimen shows the real faces. */
function useGoogleFonts(families: string[]) {
  const href = families.length ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700`).join('&')}&display=swap` : '';
  useEffect(() => {
    if (!href) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return () => link.remove();
  }, [href]);
}

export function BrandPanel({ run }: { run: Run }) {
  const qc = useQueryClient();
  const brand = run.product?.brand;
  const fonts = useQuery({ queryKey: ['fonts'], queryFn: api.fonts, staleTime: Infinity });
  const [draft, setDraft] = useState<BrandProfile | null>(brand?.profile ?? null);
  useEffect(() => setDraft(brand?.profile ?? null), [brand?.profile]);

  const familyOf = useMemo(() => {
    const m = new Map<string, { family: string; weight: number }>();
    for (const f of fonts.data ?? []) for (const h of f.handles) m.set(h.handle, { family: f.family, weight: h.weight });
    return m;
  }, [fonts.data]);
  const headingFont = draft ? familyOf.get(draft.fonts.heading.handle) : undefined;
  const bodyFont = draft ? familyOf.get(draft.fonts.body.handle) : undefined;
  useGoogleFonts([...new Set([headingFont?.family, bodyFont?.family].filter((x): x is string => !!x))]);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patchBrand(brand!.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', run.id] }),
  });
  const reset = useMutation({ mutationFn: () => api.resetBrand(brand!.id), onSuccess: () => qc.invalidateQueries({ queryKey: ['run', run.id] }) });

  if (!brand || !draft) return <Empty title="Brand analysis has not finished yet">Colours, fonts and tone appear here once the page has been captured.</Empty>;

  const changed = JSON.stringify(draft) !== JSON.stringify(brand.profile);
  const invalidColor = Object.values(draft.colors).some((c) => !HEX.test(c));
  const patch = () => {
    const p: Record<string, unknown> = {};
    const o = brand.profile;
    const colors = Object.fromEntries(Object.entries(draft.colors).filter(([k, v]) => o.colors[k as keyof typeof o.colors] !== v));
    if (Object.keys(colors).length) p.colors = colors;
    if (draft.fonts.heading.handle !== o.fonts.heading.handle || draft.fonts.body.handle !== o.fonts.body.handle) p.fonts = { heading: { handle: draft.fonts.heading.handle }, body: { handle: draft.fonts.body.handle } };
    if (JSON.stringify(draft.button) !== JSON.stringify(o.button)) p.button = draft.button;
    if (draft.spacing !== o.spacing) p.spacing = draft.spacing;
    if (JSON.stringify(draft.tone) !== JSON.stringify(o.tone)) p.tone = draft.tone;
    if (draft.toneSummary !== o.toneSummary) p.toneSummary = draft.toneSummary;
    if (draft.imageStyle !== o.imageStyle) p.imageStyle = draft.imageStyle;
    return p;
  };
  const set = (fn: (d: BrandProfile) => BrandProfile) => setDraft((d) => (d ? fn(structuredClone(d)) : d));
  const conf = brand.confidence;
  const fontSelect = (which: 'heading' | 'body') => (
    <select
      className="field"
      value={draft.fonts[which].handle}
      onChange={(e) => set((d) => ({ ...d, fonts: { ...d.fonts, [which]: { ...d.fonts[which], handle: e.target.value } } }))}
      aria-label={`${which} font`}
    >
      {!familyOf.has(draft.fonts[which].handle) && <option value={draft.fonts[which].handle}>{draft.fonts[which].handle}</option>}
      {(fonts.data ?? []).map((f) => (
        <optgroup key={f.family} label={f.family}>
          {f.handles.map((h) => <option key={h.handle} value={h.handle}>{f.family} {h.weight}</option>)}
        </optgroup>
      ))}
    </select>
  );
  const shot = `/files/runs/${run.id}/brand/desktop.jpg`;
  const mobileShot = `/files/runs/${run.id}/brand/mobile.jpg`;

  return (
    <div>
      <SectionHead
        title={`${brand.name ?? brand.domain} brand profile`}
        aside={
          <div className="flex gap-2">
            {brand.editedAt && <button className="btn-quiet" onClick={() => reset.mutate()} disabled={reset.isPending}>Reset to extracted</button>}
            <button className="btn-primary" disabled={!changed || invalidColor || save.isPending} onClick={() => save.mutate(patch())}>{save.isPending ? 'Saving…' : 'Save brand profile'}</button>
          </div>
        }
      >
        Read from the live page's CSS and cross-checked against a screenshot. Correct anything that looks wrong; your values are kept on future runs for this brand and used for designs you generate next.
      </SectionHead>
      {save.error && <div className="mb-4"><ErrorNote>{(save.error as Error).message}</ErrorNote></div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <figure className="sheet overflow-hidden">
            <img src={shot} alt={`Desktop screenshot of ${brand.domain}`} className="w-full" loading="lazy" />
            <figcaption className="flex items-center justify-between gap-2 border-t border-rule px-3 py-2 text-xs text-ink-2">
              <span>Captured from {brand.domain}</span>
              <a className="link" href={mobileShot} target="_blank" rel="noreferrer">Mobile screenshot</a>
            </figcaption>
          </figure>
          <div className="sheet p-4">
            <p className="label">Colours in the screenshot</p>
            <div className="mt-2 flex h-6 overflow-hidden rounded border border-rule">
              {brand.extracted.palette.map((c) => <span key={c.hex} title={`${c.hex} (${Math.round(c.share * 100)}%)`} style={{ background: c.hex, flexGrow: Math.max(c.share, 0.02) }} />)}
            </div>
            <p className="mt-2 text-xs text-ink-2">Used to confirm the CSS colours and to find the background when the page doesn't set one.</p>
          </div>
          <Specimen draft={draft} heading={headingFont?.family} body={bodyFont?.family} />
          {brand.extracted.notes.length > 0 && <ul className="text-sm text-warn">{brand.extracted.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>

        <div className="space-y-6">
          <fieldset className="sheet p-5">
            <legend className="sr-only">Colours</legend>
            <h3 className="font-display text-base font-bold">Colours</h3>
            <div className="mt-3 divide-y divide-rule">
              {COLOR_FIELDS.map((f) => (
                <div key={f.key} className="grid grid-cols-[28px_minmax(0,1fr)_110px] items-center gap-3 py-2.5 sm:grid-cols-[28px_minmax(0,1fr)_110px_170px]">
                  <label className="relative cursor-pointer" title="Pick a colour">
                    <Swatch hex={HEX.test(draft.colors[f.key]) ? draft.colors[f.key] : '#ffffff'} />
                    <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={HEX.test(draft.colors[f.key]) ? draft.colors[f.key].toLowerCase() : '#ffffff'} onChange={(e) => set((d) => ({ ...d, colors: { ...d.colors, [f.key]: e.target.value.toUpperCase() } }))} aria-label={`${f.label} colour picker`} />
                  </label>
                  <div className="min-w-0"><p className="text-sm font-medium">{f.label}</p><p className="truncate text-xs text-ink-2">{f.hint}</p></div>
                  <input className={`field py-1.5 font-medium uppercase ${HEX.test(draft.colors[f.key]) ? '' : 'border-bad'}`} value={draft.colors[f.key]} maxLength={7} onChange={(e) => set((d) => ({ ...d, colors: { ...d.colors, [f.key]: e.target.value.toUpperCase() } }))} aria-label={`${f.label} hex`} />
                  <span className="col-span-3 sm:col-span-1"><Confidence c={conf[f.key]} /></span>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="sheet grid gap-4 p-5 sm:grid-cols-2">
            <legend className="sr-only">Typography</legend>
            <h3 className="font-display text-base font-bold sm:col-span-2">Typography</h3>
            <div>
              <label className="label">Headings</label>
              <div className="mt-1">{fontSelect('heading')}</div>
              <p className="mt-1 text-xs text-ink-2">Site uses “{brand.profile.fonts.heading.detectedFamily}”{brand.profile.fonts.heading.matched !== 'exact' ? ', closest Shopify font chosen' : ''}.</p>
              <div className="mt-1"><Confidence c={conf.headingFont} /></div>
            </div>
            <div>
              <label className="label">Body text</label>
              <div className="mt-1">{fontSelect('body')}</div>
              <p className="mt-1 text-xs text-ink-2">Site uses “{brand.profile.fonts.body.detectedFamily}”{brand.profile.fonts.body.matched !== 'exact' ? ', closest Shopify font chosen' : ''}.</p>
              <div className="mt-1"><Confidence c={conf.bodyFont} /></div>
            </div>
          </fieldset>

          <fieldset className="sheet grid gap-4 p-5 sm:grid-cols-3">
            <legend className="sr-only">Buttons and spacing</legend>
            <h3 className="font-display text-base font-bold sm:col-span-3">Buttons and spacing</h3>
            <div>
              <label htmlFor="radius" className="label">Corner radius: {draft.button.radiusPx}px</label>
              <input id="radius" type="range" min={0} max={32} step={2} className="mt-2 w-full accent-[var(--magenta)]" value={draft.button.radiusPx} onChange={(e) => set((d) => ({ ...d, button: { ...d.button, radiusPx: Number(e.target.value) } }))} />
              <Confidence c={conf.radius} />
            </div>
            <div>
              <label htmlFor="bstyle" className="label">Button style</label>
              <select id="bstyle" className="field mt-1" value={draft.button.style} onChange={(e) => set((d) => ({ ...d, button: { ...d.button, style: e.target.value as BrandProfile['button']['style'] } }))}>
                <option value="solid">Solid</option><option value="outline">Outline</option><option value="pill">Pill</option>
              </select>
            </div>
            <div>
              <label htmlFor="spacing" className="label">Spacing</label>
              <select id="spacing" className="field mt-1" value={draft.spacing} onChange={(e) => set((d) => ({ ...d, spacing: e.target.value as BrandProfile['spacing'] }))}>
                <option value="compact">Compact</option><option value="balanced">Balanced</option><option value="airy">Airy</option>
              </select>
              <div className="mt-1"><Confidence c={conf.spacing} /></div>
            </div>
          </fieldset>

          <fieldset className="sheet p-5">
            <legend className="sr-only">Tone of voice</legend>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-base font-bold">Tone of voice and imagery</h3>
              <Confidence c={conf.tone} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Tone">
              {TONES.map((t) => {
                const on = draft.tone.includes(t);
                return (
                  <button key={t} type="button" aria-pressed={on} disabled={!on && draft.tone.length >= 4} onClick={() => set((d) => ({ ...d, tone: on ? d.tone.filter((x) => x !== t) : [...d.tone, t] }))}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-ink bg-ink text-white' : 'border-rule bg-sheet text-ink-2 hover:border-ink-3 disabled:opacity-40'}`}>{t}</button>
                );
              })}
            </div>
            <label htmlFor="tsum" className="label mt-4 block">How the brand writes</label>
            <textarea id="tsum" rows={2} maxLength={300} className="field mt-1" value={draft.toneSummary} onChange={(e) => set((d) => ({ ...d, toneSummary: e.target.value }))} />
            <label htmlFor="istyle" className="label mt-3 block">Photography style</label>
            <select id="istyle" className="field mt-1 max-w-xs" value={draft.imageStyle} onChange={(e) => set((d) => ({ ...d, imageStyle: e.target.value }))}>
              {IMAGE_STYLES.map((s) => <option key={s} value={s}>{s.replace(/-/g, ' ')}</option>)}
            </select>
          </fieldset>
        </div>
      </div>
    </div>
  );
}

/** A small proof of the brand tokens: heading, body copy and the add-to-cart button. */
function Specimen({ draft, heading, body }: { draft: BrandProfile; heading?: string; body?: string }) {
  const c = draft.colors;
  const radius = draft.button.style === 'pill' ? 999 : draft.button.radiusPx;
  const outline = draft.button.style === 'outline';
  return (
    <div className="sheet overflow-hidden">
      <div className="p-5" style={{ background: c.background, color: c.text }}>
        <p style={{ fontFamily: heading ? `"${heading}"` : undefined, fontSize: 26, lineHeight: 1.15, fontWeight: 700 }}>Made for the way you live</p>
        <p className="mt-2 text-sm" style={{ fontFamily: body ? `"${body}"` : undefined }}>This is how body copy will look on your landing pages.</p>
        <div className="mt-4 flex items-center gap-3">
          <span className="px-5 py-2.5 text-sm font-semibold" style={{ background: outline ? 'transparent' : c.button, color: outline ? c.button : c.buttonText, border: `2px solid ${c.button}`, borderRadius: radius, textTransform: draft.button.textTransform, fontFamily: body ? `"${body}"` : undefined }}>Add to cart</span>
          <span className="h-6 w-6 rounded-full" style={{ background: c.primary }} title="Primary" />
          <span className="h-6 w-6 rounded-full border border-black/10" style={{ background: c.secondary }} title="Secondary" />
        </div>
      </div>
      <p className="border-t border-rule px-3 py-2 text-xs text-ink-2">Preview of your saved tokens. Fonts come from Shopify's library.</p>
    </div>
  );
}
