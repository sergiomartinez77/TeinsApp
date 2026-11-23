import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, ErrorMessage, Icon } from '@/components/ui';
import type { MaterialVisitUsage } from '@/models/inventory.model';
import { formatQuantityWithUnit } from '@/models/material.model';
import { VISIT_STATUS_COLORS, VISIT_STATUS_LABELS } from '@/models/visit.model';
import { colors, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';
import { formatShortDate } from '@/utils/date.utils';

import { useMaterialUsageByVisit } from '../hooks/useInventory';

export interface MaterialUsageListProps {
  materialId: string;
  unit: string;
  /** Abre el detalle de la visita tocada. */
  onOpenVisit: (visitId: string) => void;
  /** Id del usuario: en las visitas de otros se muestra el técnico. */
  currentUserId: string;
}

export const USAGE_MESSAGES = {
  title: 'Uso por visita',
  empty: 'Este material no se usó en las visitas guardadas en este teléfono.',
  scope:
    'Cuenta las visitas guardadas en este teléfono; «Usado en visitas» lo calcula el servidor con todas.',
} as const;

/** "Cliente — Título" o solo el título. */
export const usageVisitName = (usage: MaterialVisitUsage) =>
  usage.clientName ? `${usage.clientName} — ${usage.title}` : usage.title;

/** Texto del resumen: "Total: 63 metro en 5 visitas". */
export function usageTotalLabel(total: number, visitCount: number, unit: string): string {
  return `Total: ${formatQuantityWithUnit(total, unit)} en ${visitCount} ${
    visitCount === 1 ? 'visita' : 'visitas'
  }`;
}

function UsageRow({
  usage,
  onOpen,
  showTechnician,
}: {
  usage: MaterialVisitUsage;
  onOpen: () => void;
  showTechnician: boolean;
}) {
  const name = usageVisitName(usage);
  const date = formatShortDate(usage.date);
  const quantity = formatQuantityWithUnit(usage.quantity, usage.unit);
  const status = VISIT_STATUS_LABELS[usage.status];
  const technician = showTechnician ? (usage.technicianName ?? 'otro técnico') : null;
  const details = [date, status, technician ? `Técnico: ${technician}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${quantity}. ${details}`}
      accessibilityHint="Abre la visita"
      testID={`usage-${usage.visitId}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowTexts}>
        <AppText variant="titleSmall" numberOfLines={2}>
          {name}
        </AppText>
        <AppText variant="bodySmall" color={VISIT_STATUS_COLORS[usage.status]} numberOfLines={2}>
          {details}
        </AppText>
      </View>
      <AppText variant="titleSmall" style={styles.quantity}>
        {quantity}
      </AppText>
      <Icon name="chevron-right" size={20} color={colors.grey500} />
    </Pressable>
  );
}

/**
 * "Uso por visita" desplegable: el total arriba y una fila por visita (sin
 * sumar entre visitas), de la más reciente a la más antigua. Al tocar una
 * fila se abre esa visita.
 */
export function MaterialUsageList({
  materialId,
  unit,
  onOpenVisit,
  currentUserId,
}: MaterialUsageListProps) {
  const [open, setOpen] = useState(false);
  const { usage, isLoading, hasError } = useMaterialUsageByVisit(materialId);
  const total = usageTotalLabel(usage.total, usage.visitCount, unit);

  return (
    <View style={styles.section} testID="material-usage">
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${USAGE_MESSAGES.title}. ${total}`}
        accessibilityHint={open ? 'Oculta la lista de visitas' : 'Muestra la lista de visitas'}
        testID="material-usage-toggle"
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <View style={styles.rowTexts}>
          <AppText variant="titleSmall" accessibilityRole="header">
            {USAGE_MESSAGES.title}
          </AppText>
          <AppText variant="bodySmall">{isLoading ? 'Cargando...' : total}</AppText>
        </View>
        <Icon name={open ? 'expand-less' : 'expand-more'} size={24} color={colors.primary} />
      </Pressable>

      {open ? (
        <View style={styles.list}>
          {hasError ? <ErrorMessage message={DEFAULT_ERROR_MESSAGES.database} /> : null}
          {!hasError && !isLoading && usage.visits.length === 0 ? (
            <AppText variant="bodySmall">{USAGE_MESSAGES.empty}</AppText>
          ) : null}
          {usage.visits.map((visit) => (
            <UsageRow
              key={visit.visitId}
              usage={visit}
              showTechnician={visit.technicianId !== currentUserId}
              onOpen={() => onOpenVisit(visit.visitId)}
            />
          ))}
          {usage.visitCount > usage.visits.length ? (
            <AppText variant="bodySmall">
              {`Se muestran las ${usage.visits.length} visitas más recientes de ${usage.visitCount}.`}
            </AppText>
          ) : null}
          <AppText variant="bodySmall" color={colors.textSecondary}>
            {USAGE_MESSAGES.scope}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.minTouchTarget,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.minTouchTarget,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowTexts: {
    flex: 1,
    gap: 2,
  },
  quantity: {
    maxWidth: '35%',
    textAlign: 'right',
  },
  pressed: {
    opacity: 0.6,
  },
});
