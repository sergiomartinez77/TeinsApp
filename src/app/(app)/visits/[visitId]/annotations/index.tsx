import { usePowerSync } from '@powersync/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import {
  AppText,
  Button,
  ConnectivityBanner,
  EmptyState,
  ErrorScreen,
  LoadingScreen,
} from '@/components/ui';
import { NameDialog } from '@/features/annotations/components/NameDialog';
import { PlanCard } from '@/features/annotations/components/PlanCard';
import { useVisitAnnotations } from '@/features/annotations/hooks/useVisitAnnotations';
import {
  createAnnotation,
  deleteAnnotation,
  renameAnnotation,
} from '@/features/annotations/services/annotation.service';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { planCountLabel, planTitle, type VisitAnnotation } from '@/models/annotation.model';
import {
  canEditVisit,
  isOwnVisit,
  readOnlyVisitMessage,
  visitOwnerLabel,
  visitScopeFor,
} from '@/models/visit.model';
import { colors, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES, type Result } from '@/types/errors';

type NameRequest = { kind: 'create' } | { kind: 'rename'; plan: VisitAnnotation; title: string };

/**
 * Ruta `/visits/[visitId]/annotations` — planos de la visita: lista con
 * miniaturas y botón "Nuevo plano". Cada plano se abre en su editor.
 */
export default function VisitPlansScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const db = usePowerSync();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const user = useRequiredUser();
  const isOnline = useConnectivity();
  const visitQuery = useVisit(visitScopeFor(user), visitId);
  const plansQuery = useVisitAnnotations(visitId);
  const [naming, setNaming] = useState<NameRequest | null>(null);

  const { annotations } = plansQuery;
  const screen = (content: ReactNode) => (
    <View style={styles.screen}>
      <AppBar
        title="Planos"
        subtitle={annotations.length > 0 ? planCountLabel(annotations.length) : undefined}
        bottom={<ConnectivityBanner isOnline={isOnline} />}
      />
      {content}
    </View>
  );

  if (visitQuery.isLoading || plansQuery.isLoading) {
    return screen(<LoadingScreen message="Cargando planos..." />);
  }
  const { visit } = visitQuery;
  const hasError = visitQuery.hasError || plansQuery.hasError;
  if (hasError || !visit) {
    return screen(
      <ErrorScreen
        message={hasError ? DEFAULT_ERROR_MESSAGES.database : VISIT_MESSAGES.notFound}
      />,
    );
  }

  const editable = canEditVisit(visit, user);
  const titleOf = (plan: VisitAnnotation) => planTitle(plan, annotations.indexOf(plan) + 1);
  const open = (plan: VisitAnnotation) =>
    router.push({
      pathname: '/visits/[visitId]/annotations/[annotationId]',
      params: { visitId, annotationId: plan.id },
    });

  const showError = (result: Result<unknown>) => {
    if (!result.ok) Alert.alert('No se pudo completar', result.error.message);
  };

  const confirmName = async (name: string) => {
    const request = naming;
    setNaming(null);
    if (!request) return;
    if (request.kind === 'create') {
      const result = await createAnnotation(db, user.id, { visitId, title: name });
      if (result.ok) open(result.data);
      else showError(result);
      return;
    }
    showError(
      await renameAnnotation(db, user.id, {
        visitId,
        annotationId: request.plan.id,
        title: name,
      }),
    );
  };

  const confirmDelete = (plan: VisitAnnotation) =>
    Alert.alert(
      'Eliminar plano',
      `¿Eliminar "${titleOf(plan)}"? Se borrarán todos sus elementos y no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () =>
            void deleteAnnotation(db, user.id, { visitId, annotationId: plan.id }).then(showError),
        },
      ],
    );

  if (!editable && annotations.length === 0) {
    return screen(
      <EmptyState
        icon="lock"
        message={isOwnVisit(visit, user.id) ? 'La visita está cerrada' : visitOwnerLabel(visit)}
        hint="No se dibujó ningún plano en esta visita."
      />,
    );
  }

  return screen(
    <>
      <FlatList
        data={annotations}
        keyExtractor={(plan) => plan.id}
        renderItem={({ item }) => (
          <PlanCard
            plan={item}
            title={titleOf(item)}
            editable={editable}
            onOpen={open}
            onRename={(plan) => setNaming({ kind: 'rename', plan, title: plan.title ?? '' })}
            onDelete={confirmDelete}
          />
        )}
        ListHeaderComponent={
          annotations.length > 0 ? (
            <AppText variant="bodyMedium" color={colors.textSecondary}>
              {readOnlyVisitMessage(
                visit,
                user,
                'La visita está cerrada: los planos son de solo lectura.',
              ) ?? 'Toca un plano para dibujar. Puedes tener varios planos en la visita.'}
            </AppText>
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyState
            icon="architecture"
            message="Sin planos"
            hint="Toca “Nuevo plano” para dibujar el primero."
          />
        }
        ListFooterComponent={
          editable ? (
            <Button
              label="Nuevo plano"
              icon="add"
              onPress={() => setNaming({ kind: 'create' })}
              testID="plan-create"
            />
          ) : undefined
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
      {naming ? (
        <NameDialog
          title={naming.kind === 'create' ? 'Nuevo plano' : 'Renombrar plano'}
          label="Nombre del plano"
          confirmLabel={naming.kind === 'create' ? 'Crear' : 'Guardar'}
          initialValue={naming.kind === 'rename' ? naming.title : ''}
          placeholder={`Plano ${annotations.length + 1}`}
          onConfirm={(name) => void confirmName(name)}
          onCancel={() => setNaming(null)}
          testID="plan-name"
        />
      ) : null}
    </>,
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
});
