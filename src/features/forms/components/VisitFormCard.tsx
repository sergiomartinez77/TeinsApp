import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Card, Icon } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { formStateLabel, progressLabel, type VisitFormItem } from '../services/visit-forms';

export interface VisitFormCardProps {
  form: VisitFormItem;
  onPress: (form: VisitFormItem) => void;
}

/** Formulario de la visita: nombre de la plantilla, estado y progreso de los obligatorios. */
export function VisitFormCard({ form, onPress }: VisitFormCardProps) {
  const state = formStateLabel(form);
  const progress = progressLabel(form.progress);

  return (
    <Card
      onPress={() => onPress(form)}
      accessibilityLabel={`${form.name}, ${state}, ${progress}`}
      testID={`visit-form-${form.response.id}`}
    >
      <View style={styles.row}>
        <Icon
          name={form.isComplete ? 'task-alt' : 'assignment'}
          size={28}
          color={form.isComplete ? colors.success : colors.primary}
        />
        <View style={styles.texts}>
          <AppText variant="titleMedium">{form.name}</AppText>
          <AppText variant="bodyMedium" color={colors.textSecondary}>
            {progress}
          </AppText>
          <Badge
            label={state}
            color={form.isComplete ? colors.success : colors.visitInProgress}
            style={styles.badge}
          />
        </View>
        <Icon name="chevron-right" size={24} color={colors.grey500} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  texts: {
    flex: 1,
    gap: spacing.xs,
  },
  badge: {
    alignSelf: 'flex-start',
  },
});
