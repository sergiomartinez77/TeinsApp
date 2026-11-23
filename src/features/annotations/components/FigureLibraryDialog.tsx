import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, Dialog, EmptyState, IconButton } from '@/components/ui';
import type { AnnotationFigure } from '@/models/annotation.model';
import { colors, radius, spacing } from '@/theme';

import { formatLength } from '../services/geometry';

import { PlanPreview } from './PlanPreview';

const THUMBNAIL = 72;

export interface FigureLibraryDialogProps {
  figures: readonly AnnotationFigure[];
  isLoading: boolean;
  onInsert: (figure: AnnotationFigure) => void;
  onDelete: (figure: AnnotationFigure) => void;
  onClose: () => void;
}

/**
 * Biblioteca de figuras del técnico: tocar una la coloca en el centro de la
 * pantalla. Las figuras se crean seleccionando elementos y tocando
 * "Guardar como figura"; sirven en todas las visitas.
 */
export function FigureLibraryDialog({
  figures,
  isLoading,
  onInsert,
  onDelete,
  onClose,
}: FigureLibraryDialogProps) {
  const confirmDelete = (figure: AnnotationFigure) =>
    Alert.alert(
      'Eliminar figura',
      `¿Eliminar "${figure.name}" de tus figuras? Los planos donde ya la usaste no cambian.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => onDelete(figure) },
      ],
    );

  return (
    <Dialog
      visible
      title="Figuras guardadas"
      onDismiss={onClose}
      position="bottom"
      testID="figure-library"
      actions={<Button label="Cerrar" variant="text" onPress={onClose} testID="figure-close" />}
    >
      {figures.length === 0 ? (
        <EmptyState
          icon="category"
          message={isLoading ? 'Cargando figuras...' : 'Aún no tienes figuras'}
          hint="Con la herramienta Seleccionar, marca elementos del plano y toca “Guardar como figura”."
        />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {figures.map((figure) => (
            <View key={figure.id} style={styles.row}>
              <Pressable
                onPress={() => onInsert(figure)}
                accessibilityRole="button"
                accessibilityLabel={`Insertar ${figure.name}`}
                testID={`figure-insert-${figure.id}`}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              >
                <PlanPreview elements={figure.elements} width={THUMBNAIL} height={THUMBNAIL} />
                <View style={styles.text}>
                  <AppText variant="titleSmall" numberOfLines={1}>
                    {figure.name}
                  </AppText>
                  <AppText variant="bodySmall" color={colors.textSecondary}>
                    {`${formatLength(figure.width)} × ${formatLength(figure.height)}`}
                  </AppText>
                </View>
              </Pressable>
              <IconButton
                icon="delete-outline"
                accessibilityLabel={`Eliminar ${figure.name}`}
                color={colors.textSecondary}
                onPress={() => confirmDelete(figure)}
                testID={`figure-delete-${figure.id}`}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 380,
  },
  listContent: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xs,
    borderRadius: radius.md,
  },
  pressed: {
    backgroundColor: colors.grey100,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});
