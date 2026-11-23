import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import {
  AppText,
  Button,
  ConnectivityBanner,
  ErrorScreen,
  Icon,
  IconButton,
  LoadingScreen,
  ReadOnlyNotice,
} from '@/components/ui';
import { AutosaveIndicator } from '@/features/forms/components/AutosaveIndicator';
import { FormSectionView } from '@/features/forms/components/FormSectionView';
import { SectionChips } from '@/features/forms/components/SectionChips';
import { useFormEditor } from '@/features/forms/hooks/useFormEditor';
import { useFormTemplates } from '@/features/forms/hooks/useFormTemplates';
import { useFormResponseFor } from '@/features/forms/hooks/useVisitForms';
import {
  findTemplate,
  resolveTemplateForResponse,
  templateForVisitType,
} from '@/features/forms/services/template.service';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import type { FormResponse, FormTemplate } from '@/models/form.model';
import {
  canEditVisit,
  readOnlyVisitMessage,
  visitScopeFor,
  type Visit,
} from '@/models/visit.model';
import { colors, contentWidths, radius, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';
import { formatDateTime } from '@/utils/date.utils';

const TEMPLATE_NOT_FOUND = 'No se encontró la plantilla de este formulario.';

/**
 * Ruta `/visits/[visitId]/form` — un formulario técnico de la visita, con
 * autoguardado. Parámetros: `templateId` (plantilla del formulario) y, al
 * abrirlo desde la lista, `responseId` (la respuesta ya empezada). Sin
 * parámetros abre el primer formulario de la visita (como antes).
 */
export default function VisitFormScreen() {
  const { visitId, templateId, responseId } = useLocalSearchParams<{
    visitId: string;
    templateId?: string;
    responseId?: string;
  }>();
  const user = useRequiredUser();
  const isOnline = useConnectivity();

  const visitQuery = useVisit(visitScopeFor(user), visitId);
  const responseQuery = useFormResponseFor(visitId, { templateId, responseId });
  const templatesQuery = useFormTemplates();

  const { visit } = visitQuery;
  const { response } = responseQuery;
  const { catalog } = templatesQuery;

  const template = useMemo(() => {
    if (!visit) return null;
    // Con respuesta, siempre su plantilla; sin ella, la elegida en el selector.
    if (response) return resolveTemplateForResponse(catalog, response, visit.visitType);
    if (templateId) return findTemplate(catalog, templateId);
    return templateForVisitType(catalog, visit.visitType);
  }, [catalog, response, templateId, visit]);

  const fallback = (content: ReactNode) => (
    <View style={styles.screen}>
      <AppBar title="Formulario técnico" bottom={<ConnectivityBanner isOnline={isOnline} />} />
      {content}
    </View>
  );

  if (visitQuery.isLoading || responseQuery.isLoading || templatesQuery.isLoading) {
    return fallback(<LoadingScreen message="Cargando formulario..." />);
  }

  const hasError = visitQuery.hasError || responseQuery.hasError || templatesQuery.hasError;
  if (hasError || !visit) {
    return fallback(
      <ErrorScreen
        message={hasError ? DEFAULT_ERROR_MESSAGES.database : VISIT_MESSAGES.notFound}
      />,
    );
  }
  if (!template) return fallback(<ErrorScreen message={TEMPLATE_NOT_FOUND} />);

  return (
    <FormEditor
      key={template.id}
      visit={visit}
      template={template}
      response={response}
      isOnline={isOnline}
    />
  );
}

interface FormEditorProps {
  visit: Visit;
  template: FormTemplate;
  response: FormResponse | null;
  isOnline: boolean;
}

function FormEditor({ visit, template, response, isOnline }: FormEditorProps) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const user = useRequiredUser();

  const isComplete = response?.isComplete ?? false;
  // Visita cerrada o de otro técnico (admin/oficina la consultan): solo lectura.
  const readOnly = isComplete || !canEditVisit(visit, user);
  const readOnlyMessage =
    readOnlyVisitMessage(
      visit,
      user,
      'La visita está cerrada: el formulario es de solo lectura.',
    ) ?? 'La visita está cerrada: el formulario es de solo lectura.';

  const editor = useFormEditor({
    visitId: visit.id,
    technicianId: user.id,
    template,
    responseId: response?.id,
    initialValues: response?.values ?? {},
    readOnly,
  });
  const { sectionIndex, setSectionIndex } = editor;

  // Al cambiar de sección se vuelve al principio.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [sectionIndex]);

  const sections = template.sections;
  const index = Math.min(sectionIndex, sections.length - 1);
  const section = sections[index];
  const isFirst = index === 0;
  const isLast = index === sections.length - 1;

  return (
    <View style={styles.screen}>
      <AppBar
        title={template.name}
        actions={
          <>
            <AutosaveIndicator status={editor.autosaveStatus} />
            {readOnly ? null : (
              <IconButton
                icon="save"
                accessibilityLabel="Guardar ahora"
                color={colors.onPrimary}
                onPress={editor.saveNow}
                testID="form-save"
              />
            )}
          </>
        }
        bottom={<ConnectivityBanner isOnline={isOnline} />}
      />

      {sections.length > 1 ? (
        <SectionChips
          sections={sections}
          activeIndex={index}
          errorSectionIds={editor.errorSectionIds}
          onSelect={setSectionIndex}
        />
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scroll,
            {
              paddingLeft: insets.left + spacing.screenHorizontal,
              paddingRight: insets.right + spacing.screenHorizontal,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
        >
          <View style={styles.content}>
            {isComplete ? (
              <CompletedBanner
                message="Formulario completado"
                detail={response?.completedAt ? formatDateTime(response.completedAt) : undefined}
              />
            ) : readOnly ? (
              <ReadOnlyNotice message={readOnlyMessage} />
            ) : null}

            {sections.length > 1 ? (
              <AppText variant="labelMedium">
                Sección {index + 1} de {sections.length}
              </AppText>
            ) : null}

            {section ? (
              <FormSectionView
                section={section}
                control={editor.control}
                clearErrors={editor.clearErrors}
                readOnly={readOnly}
              />
            ) : null}

            <View style={styles.navigation}>
              <Button
                label="Anterior"
                icon="chevron-left"
                variant="outlined"
                onPress={() => setSectionIndex(index - 1)}
                disabled={isFirst}
                style={styles.navButton}
              />
              {!isLast ? (
                <Button
                  label="Siguiente"
                  icon="chevron-right"
                  onPress={() => setSectionIndex(index + 1)}
                  style={styles.navButton}
                />
              ) : null}
            </View>

            {isLast && !readOnly ? (
              <Button
                label="Completar formulario"
                icon="task-alt"
                color={colors.secondaryDark}
                onPress={editor.complete}
                loading={editor.isCompleting}
                testID="form-complete"
              />
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

interface CompletedBannerProps {
  message: string;
  detail?: string;
}

/** Aviso verde de formulario completado, con la fecha. */
function CompletedBanner({ message, detail }: CompletedBannerProps) {
  return (
    <View
      style={styles.banner}
      accessible
      accessibilityRole="text"
      accessibilityLabel={detail ? `${message}, ${detail}` : message}
    >
      <Icon name="check-circle" size={24} color={colors.success} />
      <View style={styles.flex}>
        <AppText variant="titleSmall" color={colors.success}>
          {message}
        </AppText>
        {detail ? <AppText variant="bodySmall">{detail}</AppText> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingTop: spacing.screenVertical,
  },
  content: {
    width: '100%',
    maxWidth: contentWidths.form,
    alignSelf: 'center',
    gap: spacing.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    borderColor: colors.success,
    backgroundColor: colors.successLight,
  },
  navigation: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  navButton: {
    flex: 1,
  },
});
