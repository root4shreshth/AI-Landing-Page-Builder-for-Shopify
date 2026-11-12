/**
 * Merge a planned structure with generated copy into a PageConfig (then validated by PageConfigSchema in
 * renderTemplate). Lengths are clamped to the catalogue limits; plain text answers become <p> richtext.
 */
import type { PageConfigInput } from '../catalogue/page-config.js';
import type { DesignCopy } from '../ai/copy.js';
import type { StructurePlan } from './planner.js';
import { isUnbackedPolicyQuestion } from '../catalogue/facts.js';

const clamp = (s: string | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const p = (s: string | undefined, n: number) => {
  const t = clamp(s, n - 7);
  return t ? `<p>${t.replace(/</g, '&lt;')}</p>` : undefined;
};
const opt = (s: string | undefined, n: number) => clamp(s, n) || undefined;

/** `claimIds`: confirmed store promises; FAQ questions about unconfirmed policies are dropped. */
export function assembleConfig(plan: StructurePlan, copy: DesignCopy, claimIds: ReadonlySet<string> = new Set()): PageConfigInput {
  const sections = plan.sections.map((s) => {
    switch (s.type) {
      case 'hero':
        return {
          type: 'hero' as const,
          settings: {
            ...s.settings,
            eyebrow: opt(copy.hero.eyebrow, 40),
            heading: clamp(copy.hero.heading, 90) || 'Made for everyday',
            subheading: p(copy.hero.subheading, 320),
            button_label: opt(copy.ctaLabel, 30) ?? 'Add to cart',
          },
          blocks: copy.hero.highlights.slice(0, 4).map((h) => ({ type: 'highlight' as const, settings: { icon: h.icon, text: clamp(h.text, 80) || '—' } })),
        };
      case 'purchase':
        return {
          type: 'purchase' as const,
          settings: { ...s.settings, description: p(copy.purchaseDescription, 1200), button_label: opt(copy.ctaLabel, 30) ?? 'Add to cart' },
          claimIds: s.claimIds,
          blocks: copy.hero.highlights.slice(0, 3).map((h) => ({ type: 'highlight' as const, settings: { icon: h.icon, text: clamp(h.text, 80) || '—' } })),
        };
      case 'benefits': {
        const items = copy.benefits.items.slice(0, 6);
        while (items.length < 2) items.push({ icon: 'check', title: 'Thoughtfully made', text: '' });
        return {
          type: 'benefits' as const,
          settings: { ...s.settings, heading: clamp(copy.benefits.heading, 90) || 'Why you will love it' },
          blocks: items.map((b) => ({ type: 'benefit' as const, settings: { icon: b.icon, title: clamp(b.title, 60) || 'Benefit', text: p(b.text, 320) } })),
        };
      }
      case 'story': {
        const chapters = copy.story.chapters.slice(0, 3).filter((c) => c.heading && c.text);
        return {
          type: 'story' as const,
          settings: { ...s.settings, heading: clamp(copy.story.heading, 90) || 'The story' },
          blocks: (chapters.length ? chapters : [{ eyebrow: '', heading: copy.hero.heading, text: copy.hero.subheading || copy.purchaseDescription }]).map((c) => ({
            type: 'chapter' as const,
            settings: { eyebrow: opt(c.eyebrow, 40), heading: clamp(c.heading, 80) || 'Chapter', text: p(c.text, 700) ?? '<p>—</p>', use_product_image: true },
          })),
        };
      }
      case 'comparison': {
        const rows = copy.comparison.rows.slice(0, 8).filter((r) => r.feature && r.ours && r.other);
        if (rows.length < 3) return null; // not enough factual rows — drop rather than pad
        return {
          type: 'comparison' as const,
          settings: { ...s.settings, heading: clamp(copy.comparison.heading, 90) || 'How it compares', other_label: clamp(copy.comparison.otherLabel, 40) || 'Typical alternative' },
          blocks: rows.map((r) => ({ type: 'row' as const, settings: { feature: clamp(r.feature, 50), ours: clamp(r.ours, 40), other: clamp(r.other, 40) } })),
        };
      }
      case 'specs':
        return {
          type: 'specs' as const,
          settings: { ...s.settings, heading: clamp(copy.specsHeading, 90) || 'Specifications' },
          maxRows: s.maxRows,
          blocks: copy.specNotes.slice(0, 2).filter((n) => n.title && n.text).map((n) => ({ type: 'note' as const, settings: { title: clamp(n.title, 40), text: p(n.text, 400) ?? '<p>—</p>' } })),
        };
      case 'faq': {
        const items = copy.faq.items.filter((q) => q.question.length >= 5 && q.answer.length >= 5 && !isUnbackedPolicyQuestion(q.question, claimIds)).slice(0, 8);
        if (items.length < 3) return null;
        return {
          type: 'faq' as const,
          settings: { ...s.settings, heading: clamp(copy.faq.heading, 90) || 'Questions, answered' },
          blocks: items.map((q) => ({ type: 'qa' as const, settings: { question: clamp(q.question, 120), answer: p(q.answer, 700)! } })),
        };
      }
      case 'gallery':
        return { type: 'gallery' as const, settings: { ...s.settings, heading: opt(copy.galleryHeading, 90) } };
      case 'reviews':
        return { type: 'reviews' as const, settings: { ...s.settings, heading: clamp(copy.reviewsHeading, 90) || 'What customers say' }, maxReviews: s.maxReviews };
      case 'trust':
        return { type: 'trust' as const, settings: s.settings, claimIds: s.claimIds };
      case 'offer':
        return { type: 'offer' as const, settings: s.settings };
      case 'facts':
        return { type: 'facts' as const, settings: s.settings, maxFacts: s.maxFacts };
      case 'marquee':
        return { type: 'marquee' as const, settings: s.settings };
    }
  });
  return {
    designName: clamp(copy.designName, 60) || plan.label,
    direction: plan.direction,
    rationale: clamp(copy.rationale, 600),
    visual: plan.visual,
    sections: sections.filter((s): s is NonNullable<typeof s> => !!s) as PageConfigInput['sections'],
  };
}
