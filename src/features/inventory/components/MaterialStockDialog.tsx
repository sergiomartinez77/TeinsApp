import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Dialog, ErrorMessage } from '@/components/ui';
import {
  formatSignedQuantity,
  STOCK_MOVEMENT_LABELS,
  type MaterialStockItem,
  type StockMovement,
} from '@/models/inventory.model';
import { formatQuantityWithUnit } from '@/models/material.model';
import { colors, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';
import { formatDateTime } from '@/utils/date.utils';

import { useMaterialStock } from '../hooks/useInventory';

import { MaterialUsageList } from './MaterialUsageList';
import { STOCK_LABELS } from './StockListTile';

export interface MaterialStockDialogProps {
  materialId: string;
  /** Admin u oficina: puede registrar compras y ajustes. */
  canManage: boolean;
  /** Admin: puede cambiar el mínimo. */
  canEditMinStock: boolean;
  onDismiss: () => void;
  onPurchase: (item: MaterialStockItem) => void;
  onAdjust: (item: MaterialStockItem) => void;
  onEditMinStock: (item: MaterialStockItem) => void;
  /** Abre una visita desde "Uso por visita". */
  onOpenVisit: (visitId: string) => void;
  /** Id del usuario conectado (para mostrar el técnico en visitas ajenas). */
  currentUserId: string;
}

export const MATERIAL_STOCK_MESSAGES = {
  notFound: 'Este material ya no está en el catálogo.',
  noMovements: 'Sin compras ni ajustes registrados.',
  pendingHint:
    'Hay cambios de este dispositivo que aún no llegan al servidor: las existencias mostradas todavía no los incluyen.',
  noData:
    'Las existencias de este material aún no llegaron a este dispositivo. Se mostrarán al sincronizar.',
  noInitialCountManager: 'Registra un ajuste con lo que hay en bodega.',
  noInitialCountViewer:
    'Aún no hay compras ni ajustes registrados: oficina debe registrar el conteo de bodega.',
  negative: 'Se usó más de lo que entró: revisa el conteo y registra un ajuste.',
} as const;

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <AppText variant="bodyMedium" color={colors.textSecondary}>
        {label}
      </AppText>
      <AppText variant={strong ? 'titleMedium' : 'bodyMedium'}>{value}</AppText>
    </View>
  );
}

function MovementRow({ movement, unit }: { movement: StockMovement; unit: string }) {
  return (
    <View style={styles.movement} testID={`movement-${movement.id}`}>
      <View style={styles.row}>
        <AppText variant="titleSmall">{STOCK_MOVEMENT_LABELS[movement.kind]}</AppText>
        <AppText
          variant="titleSmall"
          color={movement.quantity < 0 ? colors.error : colors.secondaryDark}
        >
          {`${formatSignedQuantity(movement.quantity)} ${unit}`}
        </AppText>
      </View>
      <AppText variant="bodySmall">{formatDateTime(movement.createdAt)}</AppText>
      {movement.note ? <AppText variant="bodySmall">{movement.note}</AppText> : null}
      {movement.isPending ? (
        <Badge label={STOCK_LABELS.pending} color={colors.syncing} icon="sync" />
      ) : null}
    </View>
  );
}

/** Detalle de un material: existencias, mínimo, historial y acciones según el rol. */
export function MaterialStockDialog({
  materialId,
  canManage,
  canEditMinStock,
  onDismiss,
  onPurchase,
  onAdjust,
  onEditMinStock,
  onOpenVisit,
  currentUserId,
}: MaterialStockDialogProps) {
  const { item, movements, isLoading, hasError } = useMaterialStock(materialId);
  const title = item?.name ?? 'Material';

  const actions = item ? (
    <>
      <Button label="Cerrar" variant="text" onPress={onDismiss} />
      {canEditMinStock ? (
        <Button
          label="Mínimo"
          variant="outlined"
          icon="tune"
          fullWidth={false}
          onPress={() => onEditMinStock(item)}
        />
      ) : null}
      {canManage ? (
        <>
          <Button
            label="Ajuste"
            variant="outlined"
            icon="edit"
            fullWidth={false}
            onPress={() => onAdjust(item)}
          />
          <Button
            label="Registrar compra"
            icon="add-shopping-cart"
            fullWidth={false}
            onPress={() => onPurchase(item)}
          />
        </>
      ) : null}
    </>
  ) : (
    <Button label="Cerrar" variant="text" onPress={onDismiss} />
  );

  return (
    <Dialog
      visible
      title={title}
      onDismiss={onDismiss}
      position="bottom"
      testID="material-stock-dialog"
      actions={actions}
    >
      {hasError ? <ErrorMessage message={DEFAULT_ERROR_MESSAGES.database} /> : null}
      {!isLoading && !hasError && !item ? (
        <AppText variant="bodyMedium">{MATERIAL_STOCK_MESSAGES.notFound}</AppText>
      ) : null}
      {item ? (
        <>
          <AppText variant="labelMedium">{item.code}</AppText>
          {item.isLow ? (
            <Badge label={STOCK_LABELS.low} color={colors.error} icon="warning" />
          ) : null}
          {item.stock && item.needsInitialCount ? (
            <View style={styles.levels} testID="no-initial-count">
              <Row label="En bodega" value={STOCK_LABELS.noInitialCount} strong />
              <AppText variant="bodySmall" color={colors.warning} role="status">
                {canManage
                  ? MATERIAL_STOCK_MESSAGES.noInitialCountManager
                  : MATERIAL_STOCK_MESSAGES.noInitialCountViewer}
              </AppText>
              <Row
                label="Usado en visitas"
                value={formatQuantityWithUnit(item.stock.used, item.unit)}
              />
            </View>
          ) : item.stock ? (
            <View style={styles.levels}>
              <Row
                label="En bodega"
                value={formatQuantityWithUnit(item.stock.onHand, item.unit)}
                strong
              />
              {item.isNegative ? (
                <>
                  <Badge
                    label={STOCK_LABELS.negative}
                    color={colors.error}
                    icon="error-outline"
                    style={styles.badge}
                  />
                  <AppText variant="bodySmall" color={colors.error}>
                    {MATERIAL_STOCK_MESSAGES.negative}
                  </AppText>
                </>
              ) : null}
              <Row
                label="Compras"
                value={formatQuantityWithUnit(item.stock.purchased, item.unit)}
              />
              <Row
                label="Ajustes"
                value={`${formatSignedQuantity(item.stock.adjusted)} ${item.unit}`}
              />
              <Row
                label="Usado en visitas"
                value={formatQuantityWithUnit(item.stock.used, item.unit)}
              />
            </View>
          ) : (
            <AppText variant="bodyMedium">{MATERIAL_STOCK_MESSAGES.noData}</AppText>
          )}
          <Row
            label="Mínimo"
            value={
              item.minStock === null
                ? 'Sin mínimo'
                : formatQuantityWithUnit(item.minStock, item.unit)
            }
          />
          {item.hasPending ? (
            <AppText variant="bodySmall" color={colors.syncing} role="status">
              {MATERIAL_STOCK_MESSAGES.pendingHint}
            </AppText>
          ) : null}

          <AppText variant="titleSmall" accessibilityRole="header" style={styles.historyTitle}>
            Compras y ajustes
          </AppText>
          {movements.length === 0 ? (
            <AppText variant="bodySmall">{MATERIAL_STOCK_MESSAGES.noMovements}</AppText>
          ) : (
            movements.map((movement) => (
              <MovementRow key={movement.id} movement={movement} unit={item.unit} />
            ))
          )}

          <MaterialUsageList
            materialId={item.materialId}
            unit={item.unit}
            onOpenVisit={onOpenVisit}
            currentUserId={currentUserId}
          />
        </>
      ) : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  levels: {
    gap: spacing.xs,
  },
  badge: {
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  historyTitle: {
    marginTop: spacing.sm,
  },
  movement: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
