import { parseRecordSyncStatus, type RecordSyncStatus } from '@/models/visit.model';
import { formatQuantity } from '@/utils/number.utils';

// ── Entidades ────────────────────────────────────────────────────────────────

/** Material del catálogo. Es de solo lectura para el técnico. */
export interface CatalogMaterial {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly unit: string;
  readonly category: string | null;
  readonly isActive: boolean;
}

/**
 * Material usado en una visita. Código, nombre y unidad son una copia del
 * catálogo al momento de agregarlo: el registro no cambia si cambia el catálogo.
 *
 * Un material personalizado (`isCustom`) no está en el catálogo: el técnico
 * escribió su nombre y unidad solo para esta visita y no tiene `materialId`.
 */
export interface VisitMaterial {
  readonly id: string;
  readonly visitId: string;
  /** Material del catálogo; `null` en los personalizados. */
  readonly materialId: string | null;
  readonly isCustom: boolean;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly observations: string | null;
  readonly syncStatus: RecordSyncStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Conversión desde SQLite ──────────────────────────────────────────────────

const text = (value: unknown): string =>
  typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);

const optionalText = (value: unknown): string | null => {
  const result = text(value).trim();
  return result.length > 0 ? result : null;
};

const toNumber = (value: unknown): number => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

export function catalogMaterialFromRow(row: Record<string, unknown>): CatalogMaterial {
  return {
    id: text(row.id),
    code: text(row.code),
    name: text(row.name),
    description: optionalText(row.description),
    unit: text(row.unit),
    category: optionalText(row.category),
    isActive: Number(row.is_active) === 1,
  };
}

export function visitMaterialFromRow(row: Record<string, unknown>): VisitMaterial {
  return {
    id: text(row.id),
    visitId: text(row.visit_id),
    materialId: optionalText(row.material_id),
    isCustom: Number(row.is_custom) === 1,
    materialCode: text(row.material_code),
    materialName: text(row.material_name),
    unit: text(row.unit),
    quantity: toNumber(row.quantity),
    observations: optionalText(row.observations),
    syncStatus: parseRecordSyncStatus(row.sync_status),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

// ── Resumen ──────────────────────────────────────────────────────────────────

export interface UnitTotal {
  readonly unit: string;
  readonly quantity: number;
}

export interface MaterialsSummary {
  readonly count: number;
  /** "1 material" o "N materiales". */
  readonly countLabel: string;
  /** Cuántos son personalizados (no están en el catálogo). */
  readonly customCount: number;
  /** "1 personalizado" / "N personalizados"; vacío si no hay. */
  readonly customLabel: string;
  /** Totales por unidad, en el orden en que aparece cada unidad. */
  readonly totals: readonly UnitTotal[];
  /** Ej.: "120 metro · 14 unidad". */
  readonly totalsLabel: string;
}

/** Cantidad con su unidad, p. ej. "12,5 metro". */
export function formatQuantityWithUnit(quantity: number, unit: string): string {
  return `${formatQuantity(quantity)} ${unit}`.trim();
}

/**
 * Conteo de materiales y totales agrupados por unidad.
 * No se suman cantidades de unidades distintas: no tendría sentido.
 */
export function summarizeMaterials(materials: readonly VisitMaterial[]): MaterialsSummary {
  const byUnit = new Map<string, number>();
  for (const material of materials) {
    byUnit.set(material.unit, (byUnit.get(material.unit) ?? 0) + material.quantity);
  }
  // Se redondea a 3 decimales para evitar restos de coma flotante (0,1 + 0,2).
  const totals = [...byUnit].map(([unit, quantity]) => ({
    unit,
    quantity: Math.round(quantity * 1000) / 1000,
  }));
  const count = materials.length;
  const customCount = materials.filter((material) => material.isCustom).length;

  return {
    count,
    countLabel: `${count} ${count === 1 ? 'material' : 'materiales'}`,
    customCount,
    customLabel:
      customCount === 0
        ? ''
        : `${customCount} ${customCount === 1 ? 'personalizado' : 'personalizados'}`,
    totals,
    totalsLabel: totals
      .map((total) => formatQuantityWithUnit(total.quantity, total.unit))
      .join(' · '),
  };
}
