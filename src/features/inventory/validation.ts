import { z } from 'zod';

import type { StockMovementKind } from '@/models/inventory.model';
import { countDecimals, parseNumberInput } from '@/utils/number.utils';

/** Límites de las cantidades: en el servidor son NUMERIC(12,3). */
export const STOCK_QUANTITY_LIMITS = {
  maxDecimals: 3,
  max: 999_999_999,
} as const;

/** Igual que el CHECK chk_stock_movement_note del servidor. */
export const STOCK_NOTE_MAX_LENGTH = 500;

export const INVENTORY_MESSAGES = {
  quantityRequired: 'Ingresa la cantidad.',
  invalidNumber: 'Ingresa un número válido.',
  purchasePositive: 'La cantidad comprada debe ser mayor que cero.',
  adjustmentNonZero: 'El ajuste no puede ser cero. Usa un número negativo para descontar.',
  maxDecimals: 'Usa como máximo 3 decimales.',
  quantityTooLarge: 'La cantidad no puede superar 999 999 999.',
  noteTooLong: `La nota no puede superar los ${STOCK_NOTE_MAX_LENGTH} caracteres.`,
  minStockNegative: 'El mínimo no puede ser negativo.',
} as const;

/** Error de una cantidad ya convertida a número para el tipo de movimiento, o `null`. */
export function movementQuantityError(kind: StockMovementKind, value: number): string | null {
  if (!Number.isFinite(value)) return INVENTORY_MESSAGES.invalidNumber;
  if (kind === 'purchase' && value <= 0) return INVENTORY_MESSAGES.purchasePositive;
  if (kind === 'adjustment' && value === 0) return INVENTORY_MESSAGES.adjustmentNonZero;
  if (Math.abs(value) > STOCK_QUANTITY_LIMITS.max) return INVENTORY_MESSAGES.quantityTooLarge;
  if (countDecimals(value) > STOCK_QUANTITY_LIMITS.maxDecimals) {
    return INVENTORY_MESSAGES.maxDecimals;
  }
  return null;
}

/** Error del mínimo ya convertido a número, o `null`. */
export function minStockValueError(value: number): string | null {
  if (!Number.isFinite(value)) return INVENTORY_MESSAGES.invalidNumber;
  if (value < 0) return INVENTORY_MESSAGES.minStockNegative;
  if (value > STOCK_QUANTITY_LIMITS.max) return INVENTORY_MESSAGES.quantityTooLarge;
  if (countDecimals(value) > STOCK_QUANTITY_LIMITS.maxDecimals) {
    return INVENTORY_MESSAGES.maxDecimals;
  }
  return null;
}

/** Nota opcional: se recorta y, si queda vacía, es `null`. */
const noteSchema = z
  .string()
  .trim()
  .max(STOCK_NOTE_MAX_LENGTH, INVENTORY_MESSAGES.noteTooLong)
  .transform((value) => (value.length > 0 ? value : null));

/** Formulario "Registrar compra" / "Ajuste": cantidad escrita con coma o punto. */
export const stockMovementSchema = z
  .object({
    kind: z.enum(['purchase', 'adjustment']),
    quantity: z.string(),
    note: noteSchema,
  })
  .superRefine((values, ctx) => {
    if (!values.quantity.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: INVENTORY_MESSAGES.quantityRequired,
      });
      return;
    }
    const value = parseNumberInput(values.quantity, 'decimal');
    const message =
      value === null ? INVENTORY_MESSAGES.invalidNumber : movementQuantityError(values.kind, value);
    if (message) ctx.addIssue({ code: 'custom', path: ['quantity'], message });
  })
  .transform((values) => ({
    kind: values.kind,
    quantity: parseNumberInput(values.quantity, 'decimal') ?? 0,
    note: values.note,
  }));

export type StockMovementFormValues = z.input<typeof stockMovementSchema>;
export type StockMovementInput = z.output<typeof stockMovementSchema>;

/** Formulario del mínimo de bodega: vacío = sin mínimo. */
export const minStockSchema = z
  .object({ minStock: z.string() })
  .superRefine((values, ctx) => {
    if (!values.minStock.trim()) return;
    const value = parseNumberInput(values.minStock, 'decimal');
    const message = value === null ? INVENTORY_MESSAGES.invalidNumber : minStockValueError(value);
    if (message) ctx.addIssue({ code: 'custom', path: ['minStock'], message });
  })
  .transform((values) => ({
    minStock: values.minStock.trim() ? parseNumberInput(values.minStock, 'decimal') : null,
  }));

export type MinStockFormValues = z.input<typeof minStockSchema>;
export type MinStockInput = z.output<typeof minStockSchema>;
