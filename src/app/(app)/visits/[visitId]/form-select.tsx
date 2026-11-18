import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
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
import { TemplateCard } from '@/features/forms/components/TemplateCard';
import { VisitFormCard } from '@/features/forms/components/VisitFormCard';
import { useFormTemplates } from '@/features/forms/hooks/useFormTemplates';
import { useVisitFormResponses } from '@/features/forms/hooks/useVisitForms';
import {
  addableTemplates,
  buildVisitForms,
  type VisitFormItem,
} from '@/features/forms/services/visit-forms';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { isEditable } from '@/models/visit.model';
import { colors, contentWidths, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

/**
 * Ruta `/visits/[visitId]/form-select` — formularios de la visita.
 *
 * - Sin parámetros: lista de los formularios de la visita (plantilla, estado y
 *   progreso) y botón "Agregar formulario".
 * - `mode=add`: plantillas que aún no se usaron en la visita (primero las del
 *   tipo de visita). Al elegir una se abre el formulario.
 *
 * Varios formularios por visita, como máximo uno por plantilla.
 */
export default function FormSelectScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { visitId, mode } = useLocalSearchParams<{ visitId: string; mode?: string }>();
  const adding = mode === 'add';
  const user = useRequiredUser();
  const isOnline = useConnectivity();

  const visitQuery = useVisit(user.id, visitId);
  const responsesQuery = useVisitFormResponses(visitId);
  const templatesQuery = useFormTemplates();
  const { visit } = visitQuery;
  const { catalog } = templatesQuery;
  const { responses } = responsesQuery;

  const forms = useMemo(
    () => (visit ? buildVisitForms(responses, catalog, visit.visitType) : []),
    [catalog, responses, visit],
  );
  const options = useMemo(
    () => (visit ? addableTemplates(catalog, forms, visit.visitType) : []),
    [catalog, forms, visit],
  );

  const screen = (content: ReactNode) => (
    <View style={styles.screen}>
      <AppBar
        title={adding ? 'Agregar formulario' : 'Formularios técnicos'}
        bottom={<ConnectivityBanner isOnline={isOnline} />}
      />
      {content}
    </View>
  );

  if (visitQuery.isLoading || responsesQuery.isLoading || templatesQuery.isLoading) {
    return screen(<LoadingScreen message="Cargando formularios..." />);
  }

  const hasError = visitQuery.hasError || responsesQuery.hasError || templatesQuery.hasError;
  if (hasError || !visit) {
    return screen(
      <ErrorScreen
        message={hasError ? DEFAULT_ERROR_MESSAGES.database : VISIT_MESSAGES.notFound}
      />,
    );
  }

  const editable = isEditable(visit);
  const listStyle = [
    styles.list,
    {
      paddingLeft: insets.left + spacing.screenHorizontal,
      paddingRight: insets.right + spacing.screenHorizontal,
      paddingBottom: insets.bottom + spacing.lg,
    },
  ];

  if (adding) {
    if (!editable) {
      return screen(
        <EmptyState
          icon="lock"
          message="La visita está cerrada"
          hint="Ya no se pueden agregar formularios."
        />,
      );
    }
    // `replace`: al volver desde el formulario se regresa a la lista, no al selector.
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
              Elige la plantilla del nuevo formulario. Cada plantilla se usa una sola vez por
              visita.
            </AppText>
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyState
            icon="assignment"
            message={
              forms.length > 0
                ? 'Ya agregaste todas las plantillas disponibles'
                : 'No hay formularios disponibles'
            }
            hint={
              forms.length > 0
                ? 'Abre un formulario de la lista para seguir llenándolo.'
                : 'Sincroniza cuando tengas conexión para recibir las plantillas.'
            }
          />
        }
        contentContainerStyle={listStyle}
      />,
    );
  }

  if (!editable && forms.length === 0) {
    return screen(
      <EmptyState
        icon="lock"
        message="La visita está cerrada"
        hint="No se registró un formulario técnico para esta visita."
      />,
    );
  }

  // `push`: al volver desde el formulario se regresa a esta lista. Al salir, el
  // autoguardado del formulario guarda lo pendiente: nunca se pierde progreso.
  const open = (form: VisitFormItem) =>
    router.push({
      pathname: '/visits/[visitId]/form',
      params: {
        visitId,
        responseId: form.response.id,
        ...(form.template ? { templateId: form.template.id } : {}),
      },
    });
  const add = () =>
    router.push({ pathname: '/visits/[visitId]/form-select', params: { visitId, mode: 'add' } });
  const canAdd = editable && options.length > 0;

  return screen(
    <FlatList
      data={forms}
      keyExtractor={(form) => form.response.id}
      renderItem={({ item }) => <VisitFormCard form={item} onPress={open} />}
      ListHeaderComponent={
        forms.length > 0 ? (
          <AppText variant="bodyMedium" color={colors.textSecondary}>
            {editable
              ? 'Toca un formulario para seguir donde lo dejaste.'
              : 'La visita está cerrada: los formularios son de solo lectura.'}
          </AppText>
        ) : undefined
      }
      ListEmptyComponent={
        <EmptyState
          icon="assignment"
          message="Sin formularios"
          hint="Toca “Agregar formulario” para elegir la plantilla del primero."
        />
      }
      ListFooterComponent={
        canAdd ? (
          <Button label="Agregar formulario" icon="add" onPress={add} testID="add-form" />
        ) : undefined
      }
      contentContainerStyle={listStyle}
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
    maxWidth: contentWidths.form,
    alignSelf: 'center',
    gap: spacing.listItemSpacing,
    paddingTop: spacing.screenVertical,
  },
});
