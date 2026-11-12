import type { Brand, BrandProfile, Competitor, Design, Facts, FontOption, Learning, Product, Run, RunListItem } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public issues?: { path: string; message: string }[]) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.issues);
  return body as T;
}

export const api = {
  runs: () => request<RunListItem[]>('/api/runs'),
  run: (id: string) => request<Run>(`/api/runs/${id}`),
  createRun: (url: string, competitorUrls: string[]) => request<{ id: string }>('/api/runs', { method: 'POST', body: JSON.stringify({ url, ...(competitorUrls.length ? { competitorUrls } : {}) }) }),
  competitors: (id: string) => request<Competitor[]>(`/api/runs/${id}/competitors`),
  learnings: (id: string) => request<Learning[]>(`/api/runs/${id}/learnings`),
  designs: (id: string) => request<Design[]>(`/api/runs/${id}/designs`),
  fonts: () => request<FontOption[]>('/api/fonts'),
  patchBrand: (id: string, patch: Partial<BrandProfile> | Record<string, unknown>) => request<Brand>(`/api/brands/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  resetBrand: (id: string) => request<Brand>(`/api/brands/${id}/reset`, { method: 'POST' }),
  patchFacts: (productId: string, patch: Partial<Pick<Facts, 'claims' | 'specs'>> & { offer?: Facts['offer'] | null }) =>
    request<Product>(`/api/products/${productId}/facts`, { method: 'PATCH', body: JSON.stringify(patch) }),
  feedback: (designId: string, verdict: 'approved' | 'rejected', reason?: string, tags?: string[]) =>
    request<{ design: Design }>(`/api/designs/${designId}/feedback`, { method: 'POST', body: JSON.stringify({ verdict, ...(reason ? { reason } : {}), ...(tags?.length ? { tags } : {}) }) }),
  regenerate: (designId: string) => request<{ status: string }>(`/api/designs/${designId}/regenerate`, { method: 'POST' }),
};

export const fileUrl = (rel: string | null | undefined) => (rel ? `/files/${rel}` : null);

export function formatMoney(cents: number | null | undefined, format = 'Rs. {{amount}}') {
  if (cents == null) return '—';
  const amount = (cents / 100).toLocaleString('en-IN', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return format.replace(/\{\{\s*\w+\s*\}\}/, amount);
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
