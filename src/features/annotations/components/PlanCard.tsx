import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, IconButton } from '@/components/ui';
import { elementCountLabel, type VisitAnnotation } from '@/models/annotation.model';
import { colors, radius, spacing } from '@/theme';
import { formatDateTime } from '@/utils/date.utils';

import { PlanPreview } from './PlanPreview';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 72;

export interface PlanCardProps {
  plan: VisitAnnotation;
  /** Nombre visible ("Plano N" si no tiene). */
  title: string;
  editable: boolean;
  onOpen: (plan: VisitAnnotation) => void;
  onRename: (plan: VisitAnnotation) => void;
  onDelete: (plan: VisitAnnotation) => void;
}

/** Plano de la lista de la visita: miniatura, nombre, elementos y última modificación. */
export function PlanCard({ plan, title, editable, onOpen, onRename, onDelete }: PlanCardProps) {
  const updated = plan.updatedAt ?? plan.createdAt;
  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => onOpen(plan)}
        accessibilityRole="button"
        accessibilityLabel={`Abrir ${title}, ${elementCountLabel(plan.elements.length)}`}
        testID={`plan-open-${plan.id}`}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <PlanPreview elements={plan.elements} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />
        <View style={styles.text}>
          <AppText variant="titleSmall" numberOfLines={2}>
            {title}
          </AppText>
          <AppText variant="bodySmall" color={colors.textSecondary}>
            {elementCountLabel(plan.elements.length)}
          </AppText>
          {updated ? (
            <AppText variant="bodySmall" color={colors.textSecondary}>
              {`Modificado: ${formatDateTime(updated)}`}
            </AppText>
          ) : null}
        </View>
      </Pressable>
      {editable ? (
        <View style={styles.actions}>
          <IconButton
            icon="drive-file-rename-outline"
            accessibilityLabel={`Renombrar ${title}`}
            color={colors.textSecondary}
            onPress={() => onRename(plan)}
            testID={`plan-rename-${plan.id}`}
          />
          <IconButton
            icon="delete-outline"
            accessibilityLabel={`Eliminar ${title}`}
            color={colors.textSecondary}
            onPress={() => onDelete(plan)}
            testID={`plan-delete-${plan.id}`}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  pressed: {
    backgroundColor: colors.grey100,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  actions: {
    paddingRight: spacing.xs,
  },
});
