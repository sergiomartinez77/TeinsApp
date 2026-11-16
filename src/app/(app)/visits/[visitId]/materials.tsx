import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import {
  ConnectivityBanner,
  EmptyState,
  ErrorScreen,
  Fab,
  FAB_CLEARANCE,
  LoadingScreen,
  ReadOnlyNotice,
} from '@/components/ui';
import { AddMaterialSheet } from '@/features/materials/components/AddMaterialSheet';
import { EditMaterialDialog } from '@/features/materials/components/EditMaterialDialog';
import { MaterialListTile } from '@/features/materials/components/MaterialListTile';
import { MaterialsSummary } from '@/features/materials/components/MaterialsSummary';
import { useMaterialActions } from '@/features/materials/hooks/useMaterialActions';
import { useVisitMaterials } from '@/features/materials/hooks/useVisitMaterials';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import type { VisitMaterial } from '@/models/material.model';
import { isEditable } from '@/models/visit.model';
import { colors, contentWidths, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';
import { userErrorMessage } from '@/utils/result.utils';

const READ_ONLY_MESSAGE = 'La visita está cerrada: los materiales son de solo lectura.';

/** Ruta `/visits/[visitId]/materials` — materiales usados en la visita. */
export default function VisitMaterialsScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const insets = useSafeAreaInsets();
  const user = useRequiredUser();
  const isOnline = useConnectivity();

  const visitQuery = useVisit(user.id, visitId);
  const list = useVisitMaterials(visitId);
  const { add, update, remove, isBusy } = useMaterialActions(visitId);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<VisitMaterial | null>(null);

  const screen = (content: ReactNode) => (
    <View style={styles.screen}>
      <AppBar
        title="Materiales"
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
      {content}
    </View>
  );

  if (visitQuery.isLoading || list.isLoading) {
    return screen(<LoadingScreen message="Cargando materiales..." />);
  }
  const { visit } = visitQuery;
  if (visitQuery.hasError || list.hasError || !visit) {
    const hasError = visitQuery.hasError || list.hasError;
    return screen(
      <ErrorScreen
        message={hasError ? DEFAULT_ERROR_MESSAGES.database : VISIT_MESSAGES.notFound}
        onRetry={list.hasError ? list.refresh : undefined}
      />,
    );
  }

  const readOnly = !isEditable(visit);

  const closeSheet = () => {
    setSheetOpen(false);
    add.reset();
  };
  const closeEditor = () => {
    setEditing(null);
    update.reset();
  };

  const confirmRemove = (material: VisitMaterial) =>
    Alert.alert('Quitar material', `¿Quitar ${material.materialName} de la visita?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Quitar', style: 'destructive', onPress: () => remove.mutate(material.id) },
    ]);

  return screen(
    <>
      <FlatList
        data={list.materials}
        keyExtractor={(material) => material.id}
        renderItem={({ item }) => (
          <MaterialListTile
            material={item}
            readOnly={readOnly}
            onEdit={setEditing}
            onRemove={confirmRemove}
          />
        )}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          readOnly || list.summary.count > 0 ? (
            <View style={styles.header}>
              {readOnly ? <ReadOnlyNotice message={READ_ONLY_MESSAGE} /> : null}
              <MaterialsSummary summary={list.summary} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyState
            icon="inventory-2"
            message="Sin materiales registrados"
            hint={
              readOnly
                ? 'No se registraron materiales en esta visita.'
                : 'Toca “Agregar material” para registrar el primero.'
            }
          />
        }
        contentContainerStyle={[
          styles.list,
          {
            paddingLeft: insets.left + spacing.screenHorizontal,
            paddingRight: insets.right + spacing.screenHorizontal,
            // Espacio para que el botón flotante no tape el último material.
            paddingBottom: insets.bottom + FAB_CLEARANCE,
          },
        ]}
      />

      {readOnly ? null : (
        <Fab
          icon="add"
          label="Agregar material"
          onPress={() => setSheetOpen(true)}
          testID="add-material-fab"
          style={[
            styles.fab,
            { bottom: insets.bottom + spacing.md, right: insets.right + spacing.md },
          ]}
        />
      )}

      {sheetOpen && !readOnly ? (
        <AddMaterialSheet
          addedMaterialIds={list.materialIds}
          onDismiss={closeSheet}
          isSubmitting={add.isPending}
          error={add.error ? userErrorMessage(add.error) : null}
          onSubmit={(entry) => add.mutate(entry, { onSuccess: closeSheet })}
        />
      ) : null}

      {editing && !readOnly ? (
        <EditMaterialDialog
          key={editing.id}
          material={editing}
          onDismiss={closeEditor}
          isSubmitting={update.isPending}
          error={update.error ? userErrorMessage(update.error) : null}
          onSubmit={(changes) =>
            update.mutate({ ...changes, visitMaterialId: editing.id }, { onSuccess: closeEditor })
          }
        />
      ) : null}
    </>,
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
  separator: {
    height: spacing.listItemSpacing,
  },
  fab: {
    position: 'absolute',
  },
});
