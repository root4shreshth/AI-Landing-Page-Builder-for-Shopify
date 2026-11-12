import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, formatMoney } from '../api';
import type { Claim, Run } from '../types';
import type { LiveEvent } from '../useRunEvents';
import { Empty, ErrorNote, SectionHead } from './ui';

export function OverviewPanel({ run, events }: { run: Run; events: LiveEvent[] }) {
  const p = run.product;
  if (!p) {
    return (
      <div className="space-y-4">
        <SectionHead title="Reading the product page">Checking the URL is safe, reading robots.txt and fetching the product data.</SectionHead>
        <Activity events={events} />
      </div>
    );
  }
  const { snapshot, facts, sources, warnings } = p.facts;
  return (
    <div className="space-y-10">
      <section>
        <SectionHead title="What we found on the product page">Everything below comes from the page itself. Missing facts stay empty; nothing is filled in by AI.</SectionHead>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="sheet p-5">
            <div className="flex gap-4">
              <div className="grid shrink-0 grid-cols-2 gap-1.5">
                {snapshot.images.slice(0, 4).map((im) => <img key={im.src} src={im.src} alt={im.alt ?? ''} className="h-20 w-20 rounded border border-rule object-cover" loading="lazy" />)}
              </div>
              <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-ink-2">Brand</dt><dd>{facts.brandName}</dd>
                <dt className="text-ink-2">Images</dt><dd>{snapshot.images.length}</dd>
                <dt className="text-ink-2">Options</dt><dd>{snapshot.options.join(', ') || 'None'}</dd>
                <dt className="text-ink-2">Reviews</dt><dd>{facts.rating ? `${facts.rating.value} from ${facts.rating.count} reviews` : facts.reviews.length ? `${facts.reviews.length} reviews` : 'None found, so no review sections will be used'}</dd>
                <dt className="text-ink-2">Source</dt><dd className="text-ink-2">{sources.product}</dd>
              </dl>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="border-b border-rule text-left text-ink-2"><th className="py-1.5 font-medium">Variant</th><th className="py-1.5 text-right font-medium">Price</th><th className="py-1.5 text-right font-medium">Compare at</th><th className="py-1.5 text-right font-medium">Stock</th></tr></thead>
                <tbody>
                  {p.variants.map((v) => (
                    <tr key={v.id} className="border-b border-rule last:border-0">
                      <td className="py-1.5">{v.title}</td>
                      <td className="py-1.5 text-right">{formatMoney(v.priceCents, snapshot.moneyFormat)}</td>
                      <td className="py-1.5 text-right text-ink-2">{v.compareAtCents ? formatMoney(v.compareAtCents, snapshot.moneyFormat) : '—'}</td>
                      <td className={`py-1.5 text-right ${v.available ? 'text-ok' : 'text-bad'}`}>{v.available ? 'Available' : 'Sold out'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="sheet p-5">
            <h3 className="font-display text-base font-bold">Specifications</h3>
            {facts.specs.length ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {facts.specs.map((s) => <Fragment key={s.label}><dt className="text-ink-2">{s.label}</dt><dd>{s.value}</dd></Fragment>)}
              </dl>
            ) : <p className="mt-2 text-sm text-ink-2">No structured specifications on the page. The specs section is left out, and the GEO check will flag it.</p>}
            {facts.highlights.length > 0 && (
              <>
                <h3 className="mt-5 font-display text-base font-bold">Highlights</h3>
                <ul className="mt-1 list-disc pl-5 text-sm">{facts.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
              </>
            )}
          </div>
        </div>
        {warnings.length > 0 && <ul className="mt-3 space-y-1 text-sm text-warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      </section>

      <ClaimsEditor run={run} />

      <section>
        <SectionHead title="Activity" />
        <Activity events={events} stages={run.stages} />
      </section>
    </div>
  );
}

function ClaimsEditor({ run }: { run: Run }) {
  const qc = useQueryClient();
  const p = run.product!;
  const facts = p.facts.facts;
  const [offerText, setOfferText] = useState(facts.offer?.text ?? '');
  const [offerCode, setOfferCode] = useState(facts.offer?.code ?? '');
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof api.patchFacts>[1]) => api.patchFacts(p.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', run.id] }),
  });
  const remove = (c: Claim) => save.mutate({ claims: facts.claims.filter((x) => x.id !== c.id) });
  const edited = !!p.facts.userEditedAt;

  return (
    <section>
      <SectionHead title="Store promises">
        Delivery, COD, returns and offers only appear on a page when they are true for your store. These were detected on the source page; remove anything you do not offer. Changes apply to designs you generate or regenerate next.
      </SectionHead>
      {facts.claims.length === 0 ? (
        <Empty title="No promises detected">Trust badges stay hidden until you confirm a delivery, COD or returns promise.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {facts.claims.map((c) => (
            <li key={c.id} className="sheet flex gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.title}{c.text && <span className="font-normal text-ink-2"> ({c.text})</span>}</p>
                {c.evidence ? <p className="mt-1 text-sm text-ink-2">Seen on the page: <q className="text-ink">{c.evidence}</q></p> : <p className="mt-1 text-sm text-ink-2">{c.source}</p>}
              </div>
              <button type="button" className="btn-ghost self-start px-2 py-1 text-xs" onClick={() => remove(c)} disabled={save.isPending}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="sheet mt-4 grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end"
        onSubmit={(e) => { e.preventDefault(); save.mutate({ offer: offerText.trim() ? { text: offerText.trim(), code: offerCode.trim() || undefined, source: 'merchant' } : null }); }}
      >
        <div>
          <label htmlFor="offer" className="label">Current offer (only if it is really running)</label>
          <input id="offer" className="field mt-1" maxLength={80} placeholder="For example: Flat 20% off this week" value={offerText} onChange={(e) => setOfferText(e.target.value)} />
        </div>
        <div>
          <label htmlFor="code" className="label">Discount code</label>
          <input id="code" className="field mt-1" maxLength={30} value={offerCode} onChange={(e) => setOfferCode(e.target.value)} />
        </div>
        <button className="btn-ink" disabled={save.isPending}>{facts.offer ? 'Update offer' : 'Save offer'}</button>
      </form>
      {save.error && <div className="mt-2"><ErrorNote>{(save.error as Error).message}</ErrorNote></div>}
      {edited && <p className="mt-2 text-xs text-ok">Your changes are saved. Regenerate a design to apply them.</p>}
    </section>
  );
}

function Activity({ events, stages }: { events: LiveEvent[]; stages?: Run['stages'] }) {
  const rows = events.filter((e) => e.message).slice(-12).reverse();
  if (!rows.length && stages) {
    const done = stages.filter((s) => s.message);
    if (!done.length) return <p className="text-sm text-ink-2">Waiting for the first step…</p>;
    return (
      <ul className="sheet divide-y divide-rule text-sm">
        {done.map((s) => <li key={s.stage} className="flex gap-3 px-4 py-2"><span className="w-28 shrink-0 text-ink-2">{s.stage}</span><span className={s.status === 'failed' ? 'text-bad' : ''}>{s.message}</span></li>)}
      </ul>
    );
  }
  if (!rows.length) return <p className="text-sm text-ink-2">Waiting for the first step…</p>;
  return (
    <ul className="sheet divide-y divide-rule text-sm" aria-live="polite">
      {rows.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex gap-3 px-4 py-2">
          <span className="w-28 shrink-0 text-ink-2">{e.stage ?? e.type}</span>
          <span className={e.status === 'failed' ? 'text-bad' : ''}>{e.message}</span>
        </li>
      ))}
    </ul>
  );
}

