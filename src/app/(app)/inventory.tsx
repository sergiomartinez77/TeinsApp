import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import {
  AppText,
  Checkbox,
  ConnectivityBanner,
  EmptyState,
  ErrorScreen,
  Icon,
  Input,
  LoadingScreen,
  ReadOnlyNotice,
} from '@/components/ui';
import { MaterialStockDialog } from '@/features/inventory/components/MaterialStockDialog';
import { MinStockDialog } from '@/features/inventory/components/MinStockDialog';
import { PurchaseSuggestions } from '@/features/inventory/components/PurchaseSuggestions';
import { StockListTile } from '@/features/inventory/components/StockListTile';
import { StockMovementDialog } from '@/features/inventory/components/StockMovementDialog';
import { useInventory } from '@/features/inventory/hooks/useInventory';
import { useInventoryActions } from '@/features/inventory/hooks/useInventoryActions';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { MaterialStockItem, StockMovementKind } from '@/models/inventory.model';
import { canEditMinStock, canManageInventory } from '@/models/user.model';
import { useSyncStore } from '@/store/sync.store';
import { colors, contentWidths, radius, spacing, withAlpha } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';
import { userErrorMessage } from '@/utils/result.utils';

const INVENTORY_SCREEN_MESSAGES = {
  readOnly: 'Consulta de existencias. Las compras y los ajustes los registra oficina.',
  pending:
    'Hay cambios sin enviar al servidor. Las existencias que ves son las de la última sincronización y se actualizarán al sincronizar.',
} as const;

/** Qué hay abierto sobre la lista. */
type Panel =
  | { type: 'detail'; materialId: string }
  | { type: 'movement'; kind: StockMovementKind; item: MaterialStockItem }
  | { type: 'minStock'; item: MaterialStockItem }
  | null;

/** Ruta `/inventory` — existencias de la bodega, "Qué comprar" y movimientos. */
export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const user = useRequiredUser();
  const isOnline = useConnectivity();
  const pendingCount = useSyncStore((state) => state.pendingCount);

  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim(), 250);
  const [onlyLow, setOnlyLow] = useState(false);
  const inventory = useInventory({ search, onlyLow });
  const { recordMovement, updateMinStock, isBusy } = useInventoryActions();
  const [panel, setPanel] = useState<Panel>(null);

  const canManage = canManageInventory(user.role);
  const canEditMin = canEditMinStock(user.role);

  const openDetail = (item: MaterialStockItem) =>
    setPanel({ type: 'detail', materialId: item.materialId });
  const backToDetail = (item: MaterialStockItem) => {
    recordMovement.reset();
    updateMinStock.reset();
    openDetail(item);
  };

  const appBar = (
    <AppBar
      title="Inventario"
      actions={
        isBusy ? (
          <ActivityIndicator
            size="small"
            color={colors.onPrimary}
            accessibilityLabel="Guardando"
            style={styles.busy}
          />
        ) : undefined
      }
      bottom={<ConnectivityBanner isOnline={isOnline} />}
    />
  );

  if (inventory.isLoading) {
    return (
      <View style={styles.screen}>
        {appBar}
        <LoadingScreen message="Cargando inventario..." />
      </View>
    );
  }
  if (inventory.hasError) {
    return (
      <View style={styles.screen}>
        {appBar}
        <ErrorScreen message={DEFAULT_ERROR_MESSAGES.database} onRetry={inventory.refresh} />
      </View>
    );
  }

  const showPending = pendingCount > 0 || inventory.hasPending;

  return (
    <View style={styles.screen}>
      {appBar}
      <FlatList
        data={inventory.items}
        keyExtractor={(item) => item.materialId}
        renderItem={({ item }) => <StockListTile item={item} onPress={openDetail} />}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            {canManage ? null : <ReadOnlyNotice message={INVENTORY_SCREEN_MESSAGES.readOnly} />}
            {showPending ? (
              <View
                style={styles.pending}
                accessible
                accessibilityRole="text"
                accessibilityLabel={INVENTORY_SCREEN_MESSAGES.pending}
                testID="inventory-pending"
              >
                <Icon name="sync" size={20} color={colors.syncing} />
                <AppText variant="bodySmall" style={styles.pendingText}>
                  {INVENTORY_SCREEN_MESSAGES.pending}
                </AppText>
              </View>
            ) : null}
            <PurchaseSuggestions suggestions={inventory.suggestions} onOpen={openDetail} />
            <Input
              label="Buscar material"
              placeholder="Código o nombre"
              value={searchText}
              onChangeText={setSearchText}
              leftIcon="search"
              autoCorrect={false}
              returnKeyType="search"
            />
            <Checkbox label="Solo bajo mínimo" checked={onlyLow} onChange={setOnlyLow} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="inventory-2"
            message={
              search || onlyLow ? 'Ningún material coincide' : 'Sin materiales en el catálogo'
            }
            hint={
              search || onlyLow
                ? 'Prueba con otra búsqueda o quita el filtro.'
                : 'El catálogo se descarga al sincronizar.'
            }
          />
        }
        contentContainerStyle={[
          styles.list,
          {
            paddingLeft: insets.left + spacing.screenHorizontal,
            paddingRight: insets.right + spacing.screenHorizontal,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      />

      {panel?.type === 'detail' ? (
        <MaterialStockDialog
          materialId={panel.materialId}
          canManage={canManage}
          canEditMinStock={canEditMin}
          onDismiss={() => setPanel(null)}
          onPurchase={(item) => setPanel({ type: 'movement', kind: 'purchase', item })}
          onAdjust={(item) => setPanel({ type: 'movement', kind: 'adjustment', item })}
          onEditMinStock={(item) => setPanel({ type: 'minStock', item })}
        />
      ) : null}

      {panel?.type === 'movement' && canManage ? (
        <StockMovementDialog
          key={`${panel.kind}:${panel.item.materialId}`}
          item={panel.item}
          kind={panel.kind}
          onDismiss={() => backToDetail(panel.item)}
          isSubmitting={recordMovement.isPending}
          error={recordMovement.error ? userErrorMessage(recordMovement.error) : null}
          onSubmit={(input) =>
            recordMovement.mutate(
              { ...input, materialId: panel.item.materialId },
              { onSuccess: () => backToDetail(panel.item) },
            )
          }
        />
      ) : null}

      {panel?.type === 'minStock' && canEditMin ? (
        <MinStockDialog
          item={panel.item}
          onDismiss={() => backToDetail(panel.item)}
          isSubmitting={updateMinStock.isPending}
          error={updateMinStock.error ? userErrorMessage(updateMinStock.error) : null}
          onSubmit={(input) =>
            updateMinStock.mutate(
              { materialId: panel.item.materialId, minStock: input.minStock },
              { onSuccess: () => backToDetail(panel.item) },
            )
          }
        />
      ) : null}
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  busy: {
    marginRight: spacing.md,
  },
  list: {
    flexGrow: 1,
    paddingTop: spacing.screenVertical,
    width: '100%',
    maxWidth: contentWidths.list,
    alignSelf: 'center',
  },
  header: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.syncing, 0.1),
  },
  pendingText: {
    flex: 1,
  },
  separator: {
    height: spacing.listItemSpacing,
  },
});
