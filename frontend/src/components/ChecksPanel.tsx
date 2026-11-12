import type { Run } from '../types';
import { SectionHead } from './ui';

/** Placeholder until validation and publishing land (M6). States plainly what has not run yet. */
export function ChecksPanel({ run }: { run: Run }) {
  const v = run.stages.find((s) => s.stage === 'validate');
  return (
    <div>
      <SectionHead title="Checks and publishing">SEO, AEO and GEO checks, structured data validation, Lighthouse, the theme ZIP and Shopify deployment.</SectionHead>
      <div className="sheet p-6">
        <p className="font-medium">Not run yet</p>
        <p className="mt-1 max-w-xl text-sm text-ink-2">
          {v?.message ?? 'These checks have not been run for this design set. No scores are shown until a check actually runs.'}
        </p>
      </div>
    </div>
  );
}
