import { usePowerSync } from '@powersync/react';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, View, useWindowDimensions } from 'react-native';
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
import { FigureLibraryDialog } from '@/features/annotations/components/FigureLibraryDialog';
import { NameDialog } from '@/features/annotations/components/NameDialog';
import { PlanCanvas, type PlanCanvasHandle } from '@/features/annotations/components/PlanCanvas';
import { SelectionBar } from '@/features/annotations/components/SelectionBar';
import { TextElementDialog } from '@/features/annotations/components/TextElementDialog';
import { DUPLICATE_OFFSET_PX } from '@/features/annotations/constants';
import { useAnnotationEditor } from '@/features/annotations/hooks/useAnnotationEditor';
import { useFigures } from '@/features/annotations/hooks/useFigures';
import {
  useAnnotation,
  useVisitAnnotations,
} from '@/features/annotations/hooks/useVisitAnnotations';
import { ANNOTATION_MESSAGES } from '@/features/annotations/services/annotation.service';
import { deleteFigure, saveFigure } from '@/features/annotations/services/figure.service';
import { AutosaveIndicator } from '@/features/forms/components/AutosaveIndicator';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import {
  elementCountLabel,
  planTitle,
  type AnnotationFigure,
  type VisitAnnotation,
} from '@/models/annotation.model';
import {
  canEditVisit,
  readOnlyVisitMessage,
  visitScopeFor,
  type Visit,
} from '@/models/visit.model';
import { colors, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

const READ_ONLY_MESSAGE = 'La visita está cerrada: el plano es de solo lectura.';

/** Ruta `/visits/[visitId]/annotations/[annotationId]` — editor de un plano con autoguardado. */
export default function PlanEditorScreen() {
  const { visitId, annotationId } = useLocalSearchParams<{
    visitId: string;
    annotationId: string;
  }>();
  const user = useRequiredUser();
  const isOnline = useConnectivity();

  const visitQuery = useVisit(visitScopeFor(user), visitId);
  const planQuery = useAnnotation(annotationId);
  const plansQuery = useVisitAnnotations(visitId);

  const fallback = (content: ReactNode) => (
    <View style={styles.screen}>
      <AppBar
        title="Plano"
        backgroundColor={colors.grey900}
        bottom={<ConnectivityBanner isOnline={isOnline} />}
      />
      <View style={styles.fallback}>{content}</View>
    </View>
  );

  if (visitQuery.isLoading || planQuery.isLoading) {
    return fallback(<LoadingScreen message="Cargando plano..." />);
  }
  const { visit } = visitQuery;
  const plan = planQuery.annotation;
  const hasError = visitQuery.hasError || planQuery.hasError;
  if (hasError || !visit || !plan || plan.visitId !== visit.id) {
    let message: string = ANNOTATION_MESSAGES.planNotFound;
    if (hasError) message = DEFAULT_ERROR_MESSAGES.database;
    else if (!visit) message = VISIT_MESSAGES.notFound;
    return fallback(<ErrorScreen message={message} />);
  }

  const position = plansQuery.annotations.findIndex((item) => item.id === plan.id) + 1;
  return (
    <PlanEditor
      // Otro plano = otro editor (estado y autoguardado propios).
      key={plan.id}
      visit={visit}
      technicianId={user.id}
      plan={plan}
      title={planTitle(plan, Math.max(1, position))}
      isOnline={isOnline}
    />
  );
}

interface PlanEditorProps {
  visit: Visit;
  technicianId: string;
  plan: VisitAnnotation;
  title: string;
  isOnline: boolean;
}

function PlanEditor({ visit, technicianId, plan, title, isOnline }: PlanEditorProps) {
  const db = usePowerSync();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Visita cerrada o de otro técnico (admin/oficina la consultan): solo lectura.
  const readOnly = !canEditVisit(visit, { id: technicianId });
  const readOnlyMessage =
    readOnlyVisitMessage(visit, { id: technicianId }, READ_ONLY_MESSAGE) ?? READ_ONLY_MESSAGE;
  const canvasRef = useRef<PlanCanvasHandle>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [namingFigure, setNamingFigure] = useState(false);
  const figuresQuery = useFigures(technicianId);

  const editor = useAnnotationEditor({
    visitId: visit.id,
    technicianId,
    initial: plan,
    readOnly,
  });

  // En horizontal la barra va a un lado: así el plano conserva la altura.
  const sideToolbar = width > height;
  const canvasScale = () => canvasRef.current?.scale() ?? 1;

  const insertFigure = (figure: AnnotationFigure) => {
    setLibraryOpen(false);
    const center = canvasRef.current?.center() ?? { x: 0, y: 0 };
    editor.insertFigure(figure, center);
  };

  const removeFigure = async (figure: AnnotationFigure) => {
    const result = await deleteFigure(db, technicianId, figure.id);
    if (!result.ok) Alert.alert('No se pudo eliminar la figura', result.error.message);
  };

  const storeFigure = async (name: string) => {
    setNamingFigure(false);
    const result = await saveFigure(db, technicianId, {
      name,
      elements: editor.selectedElements,
    });
    if (result.ok) {
      Alert.alert('Figura guardada', `"${result.data.name}" ya está en tus figuras guardadas.`);
    } else {
      Alert.alert('No se pudo guardar la figura', result.error.message);
    }
  };

  const toolbar = readOnly ? null : (
    <AnnotationToolbar
      layout={sideToolbar ? 'side' : 'bottom'}
      tool={editor.tool}
      color={editor.color}
      sizeId={editor.sizeId}
      snap={editor.snap}
      canUndo={editor.canUndo}
      canRedo={editor.canRedo}
      onToolChange={editor.setTool}
      onColorChange={editor.setColor}
      onSizeChange={editor.setSizeId}
      onSnapChange={editor.setSnap}
      onUndo={editor.undo}
      onRedo={editor.redo}
      onOpenFigures={() => setLibraryOpen(true)}
    />
  );

  return (
    <View style={styles.screen}>
      <AppBar
        title={title}
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
          message={readOnlyMessage}
          variant="bar"
          // En horizontal el aviso no queda bajo la muesca ni los bordes redondeados.
          style={{
            paddingLeft: insets.left + spacing.md,
            paddingRight: insets.right + spacing.md,
          }}
        />
      ) : null}

      {editor.selectedIds.length > 0 ? (
        <SelectionBar
          count={editor.selectedIds.length}
          onDuplicate={() => editor.duplicateSelection(DUPLICATE_OFFSET_PX / canvasScale())}
          onSaveFigure={() => setNamingFigure(true)}
          onDelete={editor.deleteSelection}
          onClear={editor.clearSelection}
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
          <PlanCanvas
            ref={canvasRef}
            elements={editor.elements}
            selectedIds={editor.selectedIds}
            tool={editor.tool}
            color={editor.color}
            size={editor.size}
            snap={editor.snap}
            readOnly={readOnly}
            onDraw={editor.draw}
            onErase={editor.erase}
            onSelect={editor.select}
            onMove={editor.moveElements}
          />
        </View>
        {toolbar}
      </View>

      {editor.isWritingText ? (
        <TextElementDialog onConfirm={editor.confirmText} onCancel={editor.cancelText} />
      ) : null}
      {libraryOpen ? (
        <FigureLibraryDialog
          figures={figuresQuery.figures}
          isLoading={figuresQuery.isLoading}
          onInsert={insertFigure}
          onDelete={(figure) => void removeFigure(figure)}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
      {namingFigure ? (
        <NameDialog
          title="Guardar como figura"
          label="Nombre de la figura"
          confirmLabel="Guardar"
          placeholder="Ej.: Cuadro eléctrico"
          required
          onConfirm={(name) => void storeFigure(name)}
          onCancel={() => setNamingFigure(false)}
          testID="figure-name"
        />
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
  },
});
