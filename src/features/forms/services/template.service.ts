import assetTemplatesJson from '@/assets/form_templates.json';
import {
  templateFromRow,
  templatesFromAsset,
  type FormResponse,
  type FormTemplate,
} from '@/models/form.model';

/** Todas las plantillas sincronizadas en la base local (activas o no). */
export const TEMPLATES_SQL = 'SELECT * FROM form_templates';

/**
 * Plantillas de respaldo incluidas en la app. Solo viven en memoria: nunca se
 * insertan en `form_templates` (el técnico no puede escribir esa tabla y la
 * fila bloquearía la cola de subida).
 */
export const ASSET_TEMPLATES: readonly FormTemplate[] = templatesFromAsset(assetTemplatesJson);

/** Todas las plantillas conocidas y las que se ofrecen para llenar. */
export interface TemplateCatalog {
  /** Plantillas válidas de la base, activas o no (para abrir respuestas antiguas). */
  readonly database: readonly FormTemplate[];
  /** Plantillas del asset de respaldo. */
  readonly assets: readonly FormTemplate[];
  /** Plantillas disponibles para un formulario nuevo. */
  readonly available: readonly FormTemplate[];
}

/**
 * Combina las plantillas de la base con las del asset:
 * - de la base, solo las activas y, por tipo de visita, la de mayor versión;
 * - del asset, solo las de tipos de visita sin plantilla activa en la base.
 */
export function buildTemplateCatalog(
  rows: readonly Record<string, unknown>[],
  assets: readonly FormTemplate[] = ASSET_TEMPLATES,
): TemplateCatalog {
  const database = rows
    .map(templateFromRow)
    .filter((template): template is FormTemplate => template !== null);

  const latestByType = new Map<string, FormTemplate>();
  for (const template of database) {
    if (!template.isActive) continue;
    const current = latestByType.get(template.visitType);
    if (!current || template.version > current.version) {
      latestByType.set(template.visitType, template);
    }
  }

  const fromAssets = assets.filter((template) => !latestByType.has(template.visitType));
  return { database, assets, available: [...latestByType.values(), ...fromAssets] };
}

/** Busca una plantilla por id: primero en la base, luego en el asset. */
export function findTemplate(catalog: TemplateCatalog, templateId: string): FormTemplate | null {
  return (
    catalog.database.find((template) => template.id === templateId) ??
    catalog.assets.find((template) => template.id === templateId) ??
    null
  );
}

/** Plantilla disponible para un tipo de visita, si existe. */
export function templateForVisitType(
  catalog: TemplateCatalog,
  visitType: string,
): FormTemplate | null {
  return catalog.available.find((template) => template.visitType === visitType) ?? null;
}

/**
 * Plantilla con la que se llenó una respuesta: por `template_id` si existe;
 * si no, por la clave reservada del asset; si no, por el tipo de la visita.
 */
export function resolveTemplateForResponse(
  catalog: TemplateCatalog,
  response: Pick<FormResponse, 'templateId' | 'templateKey'>,
  visitType: string,
): FormTemplate | null {
  if (response.templateId) {
    const byId = catalog.database.find((template) => template.id === response.templateId);
    if (byId) return byId;
  }
  if (response.templateKey) {
    const byKey = catalog.assets.find((template) => template.id === response.templateKey);
    if (byKey) return byKey;
  }
  return templateForVisitType(catalog, visitType);
}

export interface TemplateOption {
  readonly template: FormTemplate;
  /** La plantilla corresponde al tipo de la visita. */
  readonly recommended: boolean;
}

/** Orden del selector: primero las del tipo de la visita, luego por nombre. */
export function sortTemplatesForSelector(
  templates: readonly FormTemplate[],
  visitType: string,
): TemplateOption[] {
  return templates
    .map((template) => ({ template, recommended: template.visitType === visitType }))
    .sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return a.template.name.localeCompare(b.template.name, 'es');
    });
}
