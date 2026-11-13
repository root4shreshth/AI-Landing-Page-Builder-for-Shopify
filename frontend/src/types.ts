// Shapes returned by the backend API (kept deliberately loose where the payload is JSONB).

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface Stage { stage: string; status: StageStatus; message?: string; startedAt?: string; finishedAt?: string }
export interface PipelineStep { stage: string; label: string }

export interface Variant { id: string; sourceVariantId: string; title: string; options: string[]; priceCents: number | null; compareAtCents: number | null; available: boolean | null; sku: string | null }

export interface Claim { id: string; icon: string; title: string; text?: string; source: string; evidence?: string }
export interface Facts {
  title: string;
  vendor?: string;
  brandName: string;
  category?: string;
  descriptionText: string;
  hasCompareAt: boolean;
  rating?: { value: number; count: number; source: string };
  reviews: { author: string; rating?: number; body: string }[];
  specs: { label: string; value: string; source: string }[];
  highlights: string[];
  claims: Claim[];
  offer?: { text: string; subtext?: string; code?: string; source: string };
}
export interface Snapshot {
  handle: string;
  title: string;
  vendor?: string;
  url: string;
  currency: string;
  moneyFormat: string;
  images: { src: string; alt?: string }[];
  options: string[];
  variants: { id: string | number; title: string; price: number; compareAtPrice?: number | null; available: boolean }[];
}

export interface FontRef { handle: string; detectedFamily: string; matched: 'exact' | 'closest' | 'default' }
export interface BrandProfile {
  colors: { primary: string; secondary: string; background: string; text: string; button: string; buttonText: string };
  fonts: { heading: FontRef; body: FontRef; headingSizePx?: number; bodySizePx?: number };
  button: { radiusPx: number; style: 'solid' | 'outline' | 'pill'; textTransform: 'none' | 'uppercase' | 'capitalize' };
  spacing: 'compact' | 'balanced' | 'airy';
  tone: string[];
  toneSummary: string;
  imageStyle: string;
}
export interface FieldConfidence { value: number; source: string; note?: string }
export interface Brand {
  id: string;
  domain: string;
  name: string | null;
  profile: BrandProfile;
  confidence: Record<string, FieldConfidence>;
  extracted: { profile: BrandProfile; notes: string[]; palette: { hex: string; share: number }[]; screenshots: { desktop: string | null; mobile: string | null } };
  editedAt: string | null;
}

export interface Product {
  id: string;
  sourceUrl: string;
  handle: string | null;
  title: string;
  category: string | null;
  facts: { snapshot: Snapshot; facts: Facts; sources: Record<string, string>; warnings: string[]; platform: string; userEditedAt?: string };
  brand: Brand;
  variants: Variant[];
}

export interface Cost { usd: number; inputTokens: number; outputTokens: number; entries: { step: string; model: string; usd: number }[] }

export interface Run {
  id: string;
  inputUrl: string;
  status: string;
  stage: string;
  stages: Stage[];
  pipeline: PipelineStep[];
  error: string | null;
  cost: Cost | null;
  options: { competitorUrls?: string[] } | null;
  createdAt: string;
  updatedAt: string;
  product: Product | null;
}

export interface RunListItem {
  id: string;
  inputUrl: string;
  status: string;
  createdAt: string;
  product: { id: string; title: string; category: string | null; brand: { id: string; name: string | null; domain: string } } | null;
  _count: { designs: number };
}

export interface Finding { id: string; feature: string; value: boolean; evidence: string | null }
export interface Competitor {
  id: string;
  url: string;
  domain: string;
  title: string | null;
  isIndianD2C: boolean | null;
  relevance: number | null;
  rationale: string | null;
  crawlStatus: string;
  crawlError: string | null;
  screenshots: { mobile: string | null; desktop: string | null } | null;
  structure: { source?: string; sectionOrder?: string[]; atcPlacement?: string; headlineStyle?: string; imageCount?: number } | null;
  findings: Finding[];
}

export interface Learning {
  id: string;
  key: string;
  kind: 'common' | 'differentiator' | 'rare';
  statement: string;
  hypothesis: string | null;
  recommendation: string | null;
  share: number;
  supportCount: number;
  sampleSize: number;
  sources: { competitorId: string; url: string; domain: string }[];
}

export type FeatureName = 'sectionOrder' | 'heroType' | 'composition' | 'visualStyle' | 'imageLayout' | 'atcPlacement';
export interface Similarity {
  threshold: number;
  comparedAgainst: number;
  verdict: 'first-in-category' | 'distinct' | 'similar';
  nearestPrior: { designId: string; designName?: string; score: number; features: Record<FeatureName, number>; explanation: string[] } | null;
  siblings?: { id: string; name: string; score: number }[];
  candidatesConsidered?: number;
}
export interface Design {
  id: string;
  runId: string;
  direction: 'story-led' | 'benefit-grid' | 'social-proof' | 'offer-led';
  name: string;
  status: 'draft' | 'approved' | 'rejected' | 'superseded';
  version: number;
  parentId: string | null;
  templateKey: string;
  createdAt: string;
  previewUrl: string | null;
  templateUrl: string | null;
  /** preview recorded for this design but its file is not in this machine's storage folder */
  previewMissing?: boolean;
  /** the template JSON is on disk, so the preview can be rebuilt without an AI call */
  canRerender?: boolean;
  config: {
    config: { designName: string; rationale?: string; visual: { colorStrategy: string; radius: string; density: string; accent: string }; sections: { type: string; settings: Record<string, unknown> }[] };
    label: string;
    variantId: string;
    appliedLearnings: { key: string; how: string }[];
    dataNotes: string[];
    copyCheck: { unsupportedNumbers: string[] };
    renderedOrder: string[];
  };
  fingerprint: { features: Record<string, unknown>; similarity: Similarity } | null;
  feedback: { id: string; verdict: string; reason: string | null; createdAt: string }[];
  checks: DesignChecks | null;
}

export interface FontOption { family: string; category: string; handles: { handle: string; weight: number }[] }

export type CheckStatus = 'passed' | 'failed' | 'needs_verification' | 'not_applicable';
export interface CheckItem { id: string; area: 'seo' | 'aeo' | 'geo' | 'schema'; label: string; status: CheckStatus; detail: string }
export interface DesignChecks {
  ranAt: string;
  checklist: { items: CheckItem[]; scores: Record<'seo' | 'aeo' | 'geo' | 'schema', { passed: number; failed: number; total: number; score: number | null }> };
  browser:
    | { error: string }
    | {
        widths: { width: number; overflowPx: number; h1Count: number; screenshot: string }[];
        atcFirstScreen: { passed: boolean; bottomPx: number | null; viewport: string };
        sticky: { passed: boolean; detail: string };
        cart: { passed: boolean; detail: string };
        jsErrors: string[];
      };
  lighthouse:
    | { status: 'not_run' | 'failed'; note: string }
    | { url: string; target: string; scores: { performance: number | null; accessibility: number | null; seo: number | null; 'best-practices': number | null }; metrics: { lcpMs: number | null; cls: number | null; tbtMs: number | null }; failedAudits: { id: string; title: string }[]; ranAt: string; reportFile?: string };
}

export interface PackageInfo {
  designIds: string[];
  templates: string[];
  zipUrl: string;
  zipBytes: number;
  csvUrl: string | null;
  themeCheck: { status: 'passed' | 'failed' | 'not_run'; errors: number; warnings: number; lpIssues: string[]; note?: string };
  builtAt: string;
}
export interface Deployment {
  id: string;
  designIds: string[];
  method: string;
  status: 'pending' | 'succeeded' | 'partial' | 'failed';
  store: string | null;
  themeId: string | null;
  themeName: string | null;
  previewUrl: string | null;
  editorUrl: string | null;
  log: string | null;
  createdAt: string;
}
export interface PublishInfo { cliInstalled: boolean; store: string | null; package: PackageInfo | null; history: Deployment[] }
