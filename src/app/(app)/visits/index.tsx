import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import {
  ConnectivityBanner,
  EmptyState,
  ErrorScreen,
  Fab,
  FAB_CLEARANCE,
  Icon,
  IconButton,
  LoadingScreen,
} from '@/components/ui';
import { CreateVisitDialog } from '@/features/visits/components/CreateVisitDialog';
import { VisitCard } from '@/features/visits/components/VisitCard';
import { VisitFilterTabs } from '@/features/visits/components/VisitFilterTabs';
import { useVisitActions } from '@/features/visits/hooks/useVisitActions';
import { useVisits } from '@/features/visits/hooks/useVisits';
import type { VisitFilter } from '@/features/visits/services/visit.queries';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { canCreateVisit, canViewAllVisits } from '@/models/user.model';
import { visitScopeFor } from '@/models/visit.model';
import { colors, contentWidths, radius, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';
import { userErrorMessage } from '@/utils/result.utils';

const EMPTY_MESSAGES: Record<VisitFilter, { message: string; hint: string }> = {
  all: {
    message: 'Aún no tienes visitas',
    hint: 'Toca “Nueva visita” para crear la primera.',
  },
  inProgress: {
    message: 'No hay visitas en progreso',
    hint: 'Abre una visita asignada y pulsa “Iniciar visita”.',
  },
  assigned: {
    message: 'No tienes visitas asignadas',
    hint: 'Las visitas nuevas aparecerán aquí.',
  },
  completed: {
    message: 'Aún no has completado visitas',
    hint: 'Las visitas finalizadas aparecerán aquí.',
  },
};

/** Ruta `/visits` — listado con búsqueda, pestañas y creación de visitas. */
export default function VisitsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ create?: string }>();
  const user = useRequiredUser();
  const isOnline = useConnectivity();
  const canCreate = canCreateVisit(user.role);

  const [filter, setFilter] = useState<VisitFilter>('all');
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim(), 250);
  // "Nueva visita" desde el dashboard llega con ?create=1: el diálogo nace abierto.
  const createRequested = params.create === '1';
  const [dialogOpen, setDialogOpen] = useState(canCreate && createRequested);

  const list = useVisits(visitScopeFor(user), filter, search);
  // Admin y oficina ven todas las visitas del teléfono (de todos los técnicos).
  const seesAll = canViewAllVisits(user.role);
  const { create } = useVisitActions();

  // Se limpia el parámetro para que no reabra el diálogo al volver a esta pantalla.
  useEffect(() => {
    if (createRequested) router.setParams({ create: undefined });
  }, [createRequested, router]);

  const openVisit = (visitId: string) =>
    router.push({ pathname: '/visits/[visitId]', params: { visitId } });

  const closeDialog = () => {
    setDialogOpen(false);
    create.reset();
  };

  const empty = search
    ? {
        message: 'Sin resultados',
        hint: `No hay visitas que coincidan con “${search}”.`,
      }
    : EMPTY_MESSAGES[filter];

  return (
    <View style={styles.screen}>
      <AppBar
        title={seesAll ? 'Visitas' : 'Mis visitas'}
        showBack={false}
        leading={
          <IconButton
            icon="home"
            accessibilityLabel="Ir al inicio"
            color={colors.onPrimary}
            onPress={() => router.navigate('/home')}
          />
        }
        bottom={
          <>
            <ConnectivityBanner isOnline={isOnline} />
            <View
              style={[
                styles.searchRow,
                {
                  marginLeft: insets.left + spacing.md,
                  marginRight: insets.right + spacing.md,
                },
              ]}
            >
              <Icon name="search" size={20} color={colors.textSecondary} />
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Buscar por título, cliente, dirección o tipo"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Buscar visitas"
                returnKeyType="search"
                autoCorrect={false}
                style={styles.searchInput}
              />
              {searchText ? (
                <IconButton
                  icon="close"
                  accessibilityLabel="Borrar búsqueda"
                  color={colors.textSecondary}
                  size={20}
                  onPress={() => setSearchText('')}
                />
              ) : null}
            </View>
            <VisitFilterTabs value={filter} onChange={setFilter} />
          </>
        }
      />

      {list.isLoading ? (
        <LoadingScreen message="Cargando visitas..." />
      ) : list.hasError ? (
        <ErrorScreen message={DEFAULT_ERROR_MESSAGES.database} onRetry={list.refresh} />
      ) : (
        <FlatList
          data={list.visits}
          keyExtractor={(visit) => visit.id}
          renderItem={({ item }) => (
            <VisitCard visit={item} onPress={openVisit} currentUserId={user.id} />
          )}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={
            <EmptyState icon="assignment" message={empty.message} hint={empty.hint} />
          }
          contentContainerStyle={[
            styles.list,
            {
              paddingLeft: insets.left + spacing.screenHorizontal,
              paddingRight: insets.right + spacing.screenHorizontal,
              // Espacio para que el botón flotante no tape la última visita.
              paddingBottom: insets.bottom + FAB_CLEARANCE,
            },
          ]}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={list.isRefreshing}
              onRefresh={list.refresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        />
      )}

      {canCreate ? (
        <Fab
          icon="add"
          label="Nueva visita"
          onPress={() => setDialogOpen(true)}
          testID="new-visit-fab"
          style={[
            styles.fab,
            { bottom: insets.bottom + spacing.md, right: insets.right + spacing.md },
          ]}
        />
      ) : null}

      <CreateVisitDialog
        visible={dialogOpen}
        onDismiss={closeDialog}
        isSubmitting={create.isPending}
        error={create.error ? userErrorMessage(create.error) : null}
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: (visit) => {
              closeDialog();
              openVisit(visit.id);
            },
          })
        }
      />
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.minTouchTarget,
    marginTop: spacing.sm,
    paddingLeft: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  list: {
    flexGrow: 1,
    paddingTop: spacing.screenVertical,
    width: '100%',
    maxWidth: contentWidths.list,
    alignSelf: 'center',
  },
  separator: {
    height: spacing.listItemSpacing,
  },
  fab: {
    position: 'absolute',
  },
});
