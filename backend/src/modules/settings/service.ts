import prisma from '../../config/database';
import {
  LabelTemplate,
  DEFAULT_LABEL_TEMPLATE,
} from '../inventory/barcodePrinter';

const LABEL_TEMPLATE_KEY = 'labelTemplate';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  return row.value as unknown as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: value as any },
    update: { value: value as any },
  });
}

export async function getLabelTemplate(): Promise<LabelTemplate> {
  const stored = await getSetting<LabelTemplate | null>(LABEL_TEMPLATE_KEY, null);
  if (!stored) return DEFAULT_LABEL_TEMPLATE;
  // Merge with defaults to fill in any missing fields after schema additions
  return {
    ...DEFAULT_LABEL_TEMPLATE,
    ...stored,
    elements:
      Array.isArray(stored.elements) && stored.elements.length > 0
        ? stored.elements
        : DEFAULT_LABEL_TEMPLATE.elements,
  };
}

export async function saveLabelTemplate(
  template: LabelTemplate
): Promise<LabelTemplate> {
  await setSetting(LABEL_TEMPLATE_KEY, template);
  return template;
}

export async function resetLabelTemplate(): Promise<LabelTemplate> {
  await setSetting(LABEL_TEMPLATE_KEY, DEFAULT_LABEL_TEMPLATE);
  return DEFAULT_LABEL_TEMPLATE;
}
