import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getDriver, listDrivers } from './drivers/registry';
import { getTransport, listTransports } from './transports/registry';
import { LabelData, LabelTemplate, LabelElement } from './ir/types';
import { DEFAULT_LABEL_TEMPLATE } from './ir/defaults';
import { listOsPrinters, OsDiscoveredPrinter } from './discovery/os-printers';
import { scanLan, TcpDiscoveredPrinter } from './discovery/tcp-scan';
import { PrinterConnection } from './transports/base';

// ─── Types exchanged with the controller ────────────────────────

export interface CreateProfileInput {
  name: string;
  vendor?: string;
  model?: string | null;
  driver: string;
  transport: string;
  connection: PrinterConnection;
  dpi?: number;
  maxWidthMm?: number;
  capabilities?: Record<string, unknown>;
  isDefault?: boolean;
}

export interface UpdateProfileInput extends Partial<CreateProfileInput> {
  isActive?: boolean;
}

export interface CreateTemplateInput {
  name: string;
  widthMm: number;
  heightMm: number;
  gapMm?: number;
  density?: number;
  speed?: number;
  elements: LabelElement[];
  isDefault?: boolean;
}

export interface PrintRequest {
  profileId?: number;
  templateId?: number;
  items: LabelData[];
}

export interface PrintResult {
  labelsPrinted: number;
  itemCount: number;
  transport: string;
  driver: string;
  /** Only populated for the 'browser' transport — base64 bytes returned to the caller. */
  browserPayload?: {
    contentType: string;
    base64: string;
  };
}

// ─── Profile CRUD ───────────────────────────────────────────────

export async function listProfiles(branchId: number) {
  return prisma.printerProfile.findMany({
    where: { branchId },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    include: {
      templates: {
        select: { id: true, name: true, isDefault: true, widthMm: true, heightMm: true },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      },
    },
  });
}

export async function getProfile(branchId: number, id: number) {
  const profile = await prisma.printerProfile.findFirst({
    where: { id, branchId },
    include: { templates: true },
  });
  if (!profile) throw new AppError(`Printer profile ${id} not found`, 404);
  return profile;
}

export async function createProfile(branchId: number, input: CreateProfileInput) {
  // Validate the referenced driver + transport exist
  getDriver(input.driver);
  getTransport(input.transport);

  return prisma.$transaction(async (tx) => {
    // If new profile should be default, clear any existing default first
    if (input.isDefault) {
      await tx.printerProfile.updateMany({
        where: { branchId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const profile = await tx.printerProfile.create({
      data: {
        branchId,
        name: input.name,
        vendor: input.vendor ?? 'generic',
        model: input.model ?? null,
        driver: input.driver,
        transport: input.transport,
        connection: (input.connection as any) ?? {},
        dpi: input.dpi ?? 203,
        maxWidthMm: input.maxWidthMm ?? 108,
        capabilities: (input.capabilities as any) ?? {},
        isDefault: input.isDefault ?? false,
      },
    });
    // Seed a default template for the new profile so the designer has
    // something to open. Customers can edit or add more afterwards.
    await tx.labelTemplate.create({
      data: {
        printerProfileId: profile.id,
        name: 'Default Template',
        widthMm: DEFAULT_LABEL_TEMPLATE.widthMm,
        heightMm: DEFAULT_LABEL_TEMPLATE.heightMm,
        gapMm: DEFAULT_LABEL_TEMPLATE.gapMm,
        density: DEFAULT_LABEL_TEMPLATE.density,
        speed: DEFAULT_LABEL_TEMPLATE.speed,
        elements: DEFAULT_LABEL_TEMPLATE.elements as any,
        isDefault: true,
      },
    });
    return profile;
  });
}

export async function updateProfile(
  branchId: number,
  id: number,
  input: UpdateProfileInput
) {
  await getProfile(branchId, id); // existence check
  if (input.driver) getDriver(input.driver);
  if (input.transport) getTransport(input.transport);

  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.printerProfile.updateMany({
        where: { branchId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.printerProfile.update({
      where: { id },
      data: {
        name: input.name,
        vendor: input.vendor,
        model: input.model ?? undefined,
        driver: input.driver,
        transport: input.transport,
        connection: input.connection as any,
        dpi: input.dpi,
        maxWidthMm: input.maxWidthMm,
        capabilities: input.capabilities as any,
        isDefault: input.isDefault,
        isActive: input.isActive,
      },
    });
  });
}

export async function deleteProfile(branchId: number, id: number) {
  await getProfile(branchId, id);
  await prisma.printerProfile.delete({ where: { id } });
}

export async function setDefaultProfile(branchId: number, id: number) {
  await getProfile(branchId, id);
  return prisma.$transaction(async (tx) => {
    await tx.printerProfile.updateMany({
      where: { branchId, isDefault: true },
      data: { isDefault: false },
    });
    return tx.printerProfile.update({
      where: { id },
      data: { isDefault: true },
    });
  });
}

// ─── Template CRUD ──────────────────────────────────────────────

export async function listTemplates(branchId: number, profileId: number) {
  await getProfile(branchId, profileId);
  return prisma.labelTemplate.findMany({
    where: { printerProfileId: profileId },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
  });
}

export async function getTemplate(branchId: number, id: number) {
  const template = await prisma.labelTemplate.findUnique({
    where: { id },
    include: { printer: true },
  });
  if (!template || template.printer.branchId !== branchId) {
    throw new AppError(`Label template ${id} not found`, 404);
  }
  return template;
}

export async function createTemplate(
  branchId: number,
  profileId: number,
  input: CreateTemplateInput
) {
  await getProfile(branchId, profileId);
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.labelTemplate.updateMany({
        where: { printerProfileId: profileId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.labelTemplate.create({
      data: {
        printerProfileId: profileId,
        name: input.name,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
        gapMm: input.gapMm ?? 2,
        density: input.density ?? 8,
        speed: input.speed ?? 4,
        elements: input.elements as any,
        isDefault: input.isDefault ?? false,
      },
    });
  });
}

export async function updateTemplate(
  branchId: number,
  id: number,
  input: Partial<CreateTemplateInput>
) {
  const existing = await getTemplate(branchId, id);
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.labelTemplate.updateMany({
        where: {
          printerProfileId: existing.printerProfileId,
          isDefault: true,
          NOT: { id },
        },
        data: { isDefault: false },
      });
    }
    return tx.labelTemplate.update({
      where: { id },
      data: {
        name: input.name,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
        gapMm: input.gapMm,
        density: input.density,
        speed: input.speed,
        elements: input.elements as any,
        isDefault: input.isDefault,
      },
    });
  });
}

export async function deleteTemplate(branchId: number, id: number) {
  await getTemplate(branchId, id);
  await prisma.labelTemplate.delete({ where: { id } });
}

// ─── Print orchestration ────────────────────────────────────────

/**
 * Resolve the profile and template for a print request, falling back to
 * the branch default profile and its default template.
 */
async function resolveProfileAndTemplate(branchId: number, req: PrintRequest) {
  const profile = req.profileId
    ? await getProfile(branchId, req.profileId)
    : await prisma.printerProfile.findFirst({
        where: { branchId, isDefault: true, isActive: true },
        include: { templates: true },
      });

  if (!profile) {
    throw new AppError(
      'No printer profile configured for this branch. Go to Settings → Printers to add one.',
      400
    );
  }

  const template = req.templateId
    ? await prisma.labelTemplate.findUnique({ where: { id: req.templateId } })
    : await prisma.labelTemplate.findFirst({
        where: { printerProfileId: profile.id, isDefault: true },
      });

  if (!template) {
    throw new AppError(
      `No label template found for printer '${profile.name}'. Open Settings → Printers → Templates to design one.`,
      400
    );
  }
  if (template.printerProfileId !== profile.id) {
    throw new AppError(
      `Template ${template.id} does not belong to printer profile ${profile.id}.`,
      400
    );
  }

  return { profile, template };
}

function toIrTemplate(row: {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  density: number;
  speed: number;
  elements: unknown;
}): LabelTemplate {
  const elements = Array.isArray(row.elements) ? (row.elements as LabelElement[]) : [];
  return {
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    gapMm: row.gapMm,
    density: row.density,
    speed: row.speed,
    elements,
  };
}

export async function print(
  branchId: number,
  req: PrintRequest
): Promise<PrintResult> {
  if (!req.items || req.items.length === 0) {
    throw new AppError('At least one label is required', 400);
  }

  const { profile, template } = await resolveProfileAndTemplate(branchId, req);
  const driver = getDriver(profile.driver);
  const transport = getTransport(profile.transport);

  const irTemplate = toIrTemplate(template);
  const output = await driver.render(irTemplate, req.items, { dpi: profile.dpi });

  const totalLabels = req.items.reduce((sum, i) => sum + (i.copies ?? 1), 0);

  // Browser transport: don't "send" server-side. Return bytes to the caller.
  if (profile.transport === 'browser') {
    return {
      labelsPrinted: totalLabels,
      itemCount: req.items.length,
      transport: profile.transport,
      driver: profile.driver,
      browserPayload: {
        contentType: output.contentType,
        base64: output.bytes.toString('base64'),
      },
    };
  }

  await transport.send({
    bytes: output.bytes,
    contentType: output.contentType,
    connection: profile.connection as PrinterConnection,
  });

  return {
    labelsPrinted: totalLabels,
    itemCount: req.items.length,
    transport: profile.transport,
    driver: profile.driver,
  };
}

/**
 * Emit a single sample label using the given profile + template — handy
 * for settings screens where the user wants to verify their configuration
 * without touching real inventory data.
 */
export async function testPrint(
  branchId: number,
  profileId: number,
  templateId?: number,
  overrideTemplate?: LabelTemplate
): Promise<PrintResult> {
  const profile = await getProfile(branchId, profileId);
  let irTemplate: LabelTemplate;

  if (overrideTemplate) {
    irTemplate = overrideTemplate;
  } else {
    const templateRow = templateId
      ? await prisma.labelTemplate.findUnique({ where: { id: templateId } })
      : await prisma.labelTemplate.findFirst({
          where: { printerProfileId: profile.id, isDefault: true },
        });
    if (!templateRow) throw new AppError('No template available for test print', 400);
    if (templateRow.printerProfileId !== profile.id) {
      throw new AppError('Template does not belong to this profile', 400);
    }
    irTemplate = toIrTemplate(templateRow);
  }

  const sample: LabelData = {
    sku: 'TEST12345',
    productName: 'Sample Product',
    variantLabel: 'M / Blue',
    price: 1999,
    copies: 1,
  };

  const driver = getDriver(profile.driver);
  const output = await driver.render(irTemplate, [sample], { dpi: profile.dpi });

  if (profile.transport === 'browser') {
    return {
      labelsPrinted: 1,
      itemCount: 1,
      transport: profile.transport,
      driver: profile.driver,
      browserPayload: {
        contentType: output.contentType,
        base64: output.bytes.toString('base64'),
      },
    };
  }

  const transport = getTransport(profile.transport);
  await transport.send({
    bytes: output.bytes,
    contentType: output.contentType,
    connection: profile.connection as PrinterConnection,
  });

  return {
    labelsPrinted: 1,
    itemCount: 1,
    transport: profile.transport,
    driver: profile.driver,
  };
}

// ─── Discovery ──────────────────────────────────────────────────

export interface DiscoveryResult {
  osPrinters: OsDiscoveredPrinter[];
  networkPrinters: TcpDiscoveredPrinter[];
}

export async function discover(): Promise<DiscoveryResult> {
  const [osPrinters, networkPrinters] = await Promise.all([
    listOsPrinters().catch(() => []),
    scanLan().catch(() => []),
  ]);
  return { osPrinters, networkPrinters };
}

// ─── Capabilities introspection (for frontend settings form) ────

export function describeDrivers() {
  return listDrivers().map((d) => ({
    name: d.name,
    displayName: d.displayName,
    capabilities: d.capabilities,
  }));
}

export function describeTransports() {
  return listTransports().map((t) => ({
    name: t.name,
    displayName: t.displayName,
    supported: t.isSupported(),
  }));
}
