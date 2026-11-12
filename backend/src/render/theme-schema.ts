import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ShopifyTemplate } from './template.js';

/**
 * Validates generated JSON templates against the ACTUAL {% schema %} of the built Liquid sections,
 * so the renderer and the section library can never silently drift apart.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_THEME_DIR = path.join(REPO_ROOT, 'shopify', 'dist', 'theme');

interface SettingDef {
  type: string;
  id?: string;
  options?: { value: string }[];
  min?: number;
  max?: number;
  step?: number;
}
interface BlockDef { type: string; limit?: number; settings?: SettingDef[] }
export interface SectionSchema { name: string; limit?: number; settings: SettingDef[]; blocks: BlockDef[] }

export async function loadSectionSchemas(themeDir = DEFAULT_THEME_DIR, prefix = 'lp-'): Promise<Map<string, SectionSchema>> {
  const dir = path.join(themeDir, 'sections');
  const map = new Map<string, SectionSchema>();
  for (const file of await readdir(dir)) {
    if (!file.startsWith(prefix) || !file.endsWith('.liquid')) continue;
    const src = await readFile(path.join(dir, file), 'utf8');
    const m = src.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
    if (!m) continue;
    const json = JSON.parse(m[1]);
    map.set(file.replace(/\.liquid$/, ''), { name: json.name, limit: json.limit, settings: json.settings ?? [], blocks: json.blocks ?? [] });
  }
  return map;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[a-z0-9_]+_[nio][1-9]$/;

function checkSetting(def: SettingDef | undefined, key: string, value: unknown, where: string, errors: string[]) {
  if (!def) {
    errors.push(`${where}: unknown setting "${key}"`);
    return;
  }
  switch (def.type) {
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') errors.push(`${where}.${key}: expected string`);
      break;
    case 'richtext':
      if (typeof value !== 'string' || !/^<(p|ul|ol)[\s>]/.test(value)) errors.push(`${where}.${key}: richtext must start with <p>, <ul> or <ol>`);
      break;
    case 'checkbox':
      if (typeof value !== 'boolean') errors.push(`${where}.${key}: expected boolean`);
      break;
    case 'color':
      if (typeof value !== 'string' || !HEX.test(value)) errors.push(`${where}.${key}: expected #RRGGBB`);
      break;
    case 'font_picker':
      if (typeof value !== 'string' || !FONT.test(value)) errors.push(`${where}.${key}: expected font handle`);
      break;
    case 'select':
      if (!def.options?.some((o) => o.value === value)) errors.push(`${where}.${key}: "${String(value)}" not in options [${def.options?.map((o) => o.value).join(', ')}]`);
      break;
    case 'range': {
      const n = value as number;
      if (typeof n !== 'number' || Number.isNaN(n)) errors.push(`${where}.${key}: expected number`);
      else {
        if (def.min !== undefined && n < def.min) errors.push(`${where}.${key}: ${n} < min ${def.min}`);
        if (def.max !== undefined && n > def.max) errors.push(`${where}.${key}: ${n} > max ${def.max}`);
        if (def.step && def.min !== undefined && Math.abs(((n - def.min) / def.step) % 1) > 1e-9) errors.push(`${where}.${key}: ${n} not on step ${def.step}`);
      }
      break;
    }
    case 'image_picker':
      if (typeof value !== 'string' || !value.startsWith('shopify://')) errors.push(`${where}.${key}: image must be a shopify:// reference`);
      break;
    default:
      // other types are not produced by the renderer
      errors.push(`${where}.${key}: renderer does not support setting type ${def.type}`);
  }
}

export function validateTemplate(template: ShopifyTemplate, schemas: Map<string, SectionSchema>): string[] {
  const errors: string[] = [];
  const typeCounts: Record<string, number> = {};
  if (template.order.length > 25) errors.push(`template has ${template.order.length} sections (Shopify max 25)`);
  for (const id of template.order) if (!template.sections[id]) errors.push(`order references missing section ${id}`);

  for (const [id, sec] of Object.entries(template.sections)) {
    const schema = schemas.get(sec.type);
    if (!schema) {
      errors.push(`${id}: section type "${sec.type}" not found in theme`);
      continue;
    }
    typeCounts[sec.type] = (typeCounts[sec.type] ?? 0) + 1;
    if (schema.limit && typeCounts[sec.type] > schema.limit) errors.push(`${id}: more than ${schema.limit} "${sec.type}" sections`);

    const defs = new Map(schema.settings.filter((s) => s.id).map((s) => [s.id!, s]));
    for (const [k, v] of Object.entries(sec.settings)) checkSetting(defs.get(k), k, v, id, errors);

    const blocks = sec.blocks ?? {};
    const blockCounts: Record<string, number> = {};
    if (Object.keys(blocks).length > 50) errors.push(`${id}: more than 50 blocks`);
    for (const [bid, b] of Object.entries(blocks)) {
      const bdef = schema.blocks.find((d) => d.type === b.type);
      if (!bdef) {
        errors.push(`${id}.${bid}: block type "${b.type}" not allowed`);
        continue;
      }
      blockCounts[b.type] = (blockCounts[b.type] ?? 0) + 1;
      if (bdef.limit && blockCounts[b.type] > bdef.limit) errors.push(`${id}: more than ${bdef.limit} "${b.type}" blocks`);
      const bdefs = new Map((bdef.settings ?? []).filter((s) => s.id).map((s) => [s.id!, s]));
      for (const [k, v] of Object.entries(b.settings)) checkSetting(bdefs.get(k), k, v, `${id}.${bid}`, errors);
    }
    for (const bid of sec.block_order ?? []) if (!blocks[bid]) errors.push(`${id}: block_order references missing ${bid}`);
  }
  return errors;
}
