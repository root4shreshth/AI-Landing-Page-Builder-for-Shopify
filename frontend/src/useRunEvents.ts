import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export interface LiveEvent { type: string; stage?: string; status?: string; message?: string; designId?: string; at: number }

/**
 * Subscribes to the run's server-sent events and refreshes the affected queries.
 * Returns the latest events (newest last) for the activity log.
 */
export function useRunEvents(runId: string | undefined) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.onmessage = (msg) => {
      let e: Omit<LiveEvent, 'at'>;
      try {
        e = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (e.type === 'snapshot') return;
      setEvents((prev) => [...prev.slice(-60), { ...e, at: Date.now() }]);
      qc.invalidateQueries({ queryKey: ['run', runId] });
      if (e.stage === 'competitors' || e.stage === 'learnings') {
        qc.invalidateQueries({ queryKey: ['competitors', runId] });
        qc.invalidateQueries({ queryKey: ['learnings', runId] });
      }
      if (e.stage === 'generate' || e.type === 'design' || e.type === 'regenerate') qc.invalidateQueries({ queryKey: ['designs', runId] });
    };
    return () => es.close();
  }, [runId, qc]);
  return events;
}
