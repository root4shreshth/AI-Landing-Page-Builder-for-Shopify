import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { RunsTable } from './Home';

export function HistoryPage() {
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  return (
    <main className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold">Run history</h1>
      <p className="mt-1 max-w-2xl text-ink-2">Every analysis, with the designs it produced. Designs from earlier runs in the same category are what new runs are checked against.</p>
      <div className="mt-6">
        <RunsTable runs={runs.data} loading={runs.isLoading} />
      </div>
    </main>
  );
}
