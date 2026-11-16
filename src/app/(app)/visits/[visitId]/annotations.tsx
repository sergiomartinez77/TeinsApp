import { useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import {
  ConnectivityBanner,
  ErrorScreen,
  IconButton,
  LoadingScreen,
  ReadOnlyNotice,
} from '@/components/ui';
import { AnnotationToolbar } from '@/features/annotations/components/AnnotationToolbar';
import { DrawingCanvas } from '@/features/annotations/components/DrawingCanvas';
import { TextElementDialog } from '@/features/annotations/components/TextElementDialog';
import { useAnnotationEditor } from '@/features/annotations/hooks/useAnnotationEditor';
import { useVisitAnnotation } from '@/features/annotations/hooks/useVisitAnnotation';
import { AutosaveIndicator } from '@/features/forms/components/AutosaveIndicator';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { elementCountLabel, type VisitAnnotation } from '@/models/annotation.model';
import { isEditable, type Visit } from '@/models/visit.model';
import { colors, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

const TITLE = 'Anotaciones';
const READ_ONLY_MESSAGE = 'La visita está cerrada: las anotaciones son de solo lectura.';

/** Ruta `/visits/[visitId]/annotations` — canvas de dibujo con autoguardado. */
export default function VisitAnnotationsScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const user = useRequiredUser();
  const isOnline = useConnectivity();

  const visitQuery = useVisit(user.id, visitId);
  const annotationQuery = useVisitAnnotation(visitId);

  const fallback = (content: ReactNode) => (
    <View style={styles.screen}>
      <AppBar
        title={TITLE}
        backgroundColor={colors.grey900}
        bottom={<ConnectivityBanner isOnline={isOnline} />}
      />
      <View style={styles.fallback}>{content}</View>
    </View>
  );

  if (visitQuery.isLoading || annotationQuery.isLoading) {
    return fallback(<LoadingScreen message="Cargando anotaciones..." />);
  }
  const { visit } = visitQuery;
  const hasError = visitQuery.hasError || annotationQuery.hasError;
  if (hasError || !visit) {
    return fallback(
      <ErrorScreen
        message={hasError ? DEFAULT_ERROR_MESSAGES.database : VISIT_MESSAGES.notFound}
      />,
    );
  }

  return (
    <AnnotationEditor
      visit={visit}
      technicianId={user.id}
      annotation={annotationQuery.annotation}
      isOnline={isOnline}
    />
  );
}

interface AnnotationEditorProps {
  visit: Visit;
  technicianId: string;
  annotation: VisitAnnotation | null;
  isOnline: boolean;
}

function AnnotationEditor({ visit, technicianId, annotation, isOnline }: AnnotationEditorProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const readOnly = !isEditable(visit);

  const editor = useAnnotationEditor({
    visitId: visit.id,
    technicianId,
    initial: annotation,
    readOnly,
  });

  // En horizontal la barra va a un lado: así el lienzo conserva la altura.
  const sideToolbar = width > height;

  const toolbar = readOnly ? null : (
    <AnnotationToolbar
      layout={sideToolbar ? 'side' : 'bottom'}
      tool={editor.tool}
      color={editor.color}
      sizeId={editor.sizeId}
      canUndo={editor.canUndo}
      onToolChange={editor.setTool}
      onColorChange={editor.setColor}
      onSizeChange={editor.setSizeId}
      onUndo={editor.undo}
    />
  );

  return (
    <View style={styles.screen}>
      <AppBar
        title={TITLE}
        subtitle={elementCountLabel(editor.elements.length)}
        backgroundColor={colors.grey900}
        actions={
          <>
            <AutosaveIndicator status={editor.autosaveStatus} />
            {readOnly ? null : (
              <IconButton
                icon="save"
                accessibilityLabel="Guardar ahora"
                color={colors.onPrimary}
                onPress={editor.saveNow}
                testID="annotations-save"
              />
            )}
          </>
        }
        bottom={<ConnectivityBanner isOnline={isOnline} />}
      />

      {readOnly ? (
        <ReadOnlyNotice
          message={READ_ONLY_MESSAGE}
          variant="bar"
          // En horizontal el aviso no queda bajo la muesca ni los bordes redondeados.
          style={{
            paddingLeft: insets.left + spacing.md,
            paddingRight: insets.right + spacing.md,
          }}
        />
      ) : null}

      <View
        style={[
          styles.body,
          sideToolbar ? styles.row : styles.column,
          {
            paddingLeft: insets.left,
            paddingRight: insets.right,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={styles.canvasArea}>
          <DrawingCanvas
            elements={editor.elements}
            reference={editor.reference}
            tool={editor.tool}
            color={editor.color}
            size={editor.size}
            readOnly={readOnly}
            onDraw={editor.draw}
            onErase={editor.erase}
          />
        </View>
        {toolbar}
      </View>

      {editor.isWritingText ? (
        <TextElementDialog onConfirm={editor.confirmText} onCancel={editor.cancelText} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.grey900,
  },
  fallback: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
  },
  column: {
    flexDirection: 'column',
  },
  row: {
    flexDirection: 'row',
  },
  canvasArea: {
    flex: 1,
    padding: spacing.sm,
  },
});
