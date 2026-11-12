import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import {
  AppText,
  ConnectivityBanner,
  EmptyState,
  ErrorScreen,
  LoadingScreen,
} from '@/components/ui';
import { TemplateCard } from '@/features/forms/components/TemplateCard';
import { useFormResponse } from '@/features/forms/hooks/useFormResponse';
import { useFormTemplates } from '@/features/forms/hooks/useFormTemplates';
import { sortTemplatesForSelector } from '@/features/forms/services/template.service';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { isEditable } from '@/models/visit.model';
import { colors, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

const CONTENT_MAX_WIDTH = 720;

/**
 * Ruta `/visits/[visitId]/form-select` — elige la plantilla del formulario.
 * Si la visita ya tiene respuesta, se abre directamente con su plantilla.
 */
export default function FormSelectScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const user = useRequiredUser();
  const isOnline = useConnectivity();

  const visitQuery = useVisit(user.id, visitId);
  const responseQuery = useFormResponse(visitId);
  const templatesQuery = useFormTemplates();

  const bar = (
    <AppBar title="Formulario técnico" bottom={<ConnectivityBanner isOnline={isOnline} />} />
  );
  const screen = (content: ReactNode) => (
    <View style={styles.screen}>
      {bar}
      {content}
    </View>
  );

  if (visitQuery.isLoading || responseQuery.isLoading || templatesQuery.isLoading) {
    return screen(<LoadingScreen message="Cargando formularios..." />);
  }

  const { visit } = visitQuery;
  const hasError = visitQuery.hasError || responseQuery.hasError || templatesQuery.hasError;
  if (hasError || !visit) {
    return screen(
      <ErrorScreen
        message={hasError ? DEFAULT_ERROR_MESSAGES.database : VISIT_MESSAGES.notFound}
      />,
    );
  }

  // Una sola respuesta por visita: si ya existe no se elige otra plantilla.
  if (responseQuery.response) {
    return <Redirect href={{ pathname: '/visits/[visitId]/form', params: { visitId } }} />;
  }

  if (!isEditable(visit)) {
    return screen(
      <EmptyState
        icon="lock"
        message="La visita está cerrada"
        hint="No se registró un formulario técnico para esta visita."
      />,
    );
  }

  const options = sortTemplatesForSelector(templatesQuery.catalog.available, visit.visitType);

  // `replace`: al volver desde el formulario se regresa al detalle, no al selector.
  const choose = (templateId: string) =>
    router.replace({ pathname: '/visits/[visitId]/form', params: { visitId, templateId } });

  return screen(
    <FlatList
      data={options}
      keyExtractor={(option) => option.template.id}
      renderItem={({ item }) => (
        <TemplateCard template={item.template} recommended={item.recommended} onPress={choose} />
      )}
      ListHeaderComponent={
        options.length > 0 ? (
          <AppText variant="bodyMedium" color={colors.textSecondary}>
            Elige la plantilla con la que vas a llenar el formulario de esta visita.
          </AppText>
        ) : undefined
      }
      ListEmptyComponent={
        <EmptyState
          icon="assignment"
          message="No hay formularios disponibles"
          hint="Sincroniza cuando tengas conexión para recibir las plantillas."
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
    />,
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    flexGrow: 1,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    gap: spacing.listItemSpacing,
    paddingTop: spacing.screenVertical,
  },
});
