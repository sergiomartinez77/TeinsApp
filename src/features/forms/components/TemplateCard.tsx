import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Card, Icon } from '@/components/ui';
import { countFields, type FormTemplate } from '@/models/form.model';
import { colors, spacing } from '@/theme';

export interface TemplateCardProps {
  template: FormTemplate;
  recommended: boolean;
  onPress: (templateId: string) => void;
}

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/** Plantilla del selector: nombre, número de secciones y de campos. */
export function TemplateCard({ template, recommended, onPress }: TemplateCardProps) {
  const sections = plural(template.sections.length, 'sección', 'secciones');
  const fields = plural(countFields(template), 'campo', 'campos');
  const summary = `${sections} · ${fields}`;

  return (
    <Card
      onPress={() => onPress(template.id)}
      accessibilityLabel={`${template.name}, ${sections}, ${fields}${recommended ? ', recomendado' : ''}`}
      testID={`template-${template.id}`}
    >
      <View style={styles.row}>
        <Icon name="assignment" size={28} color={colors.primary} />
        <View style={styles.texts}>
          <AppText variant="titleMedium">{template.name}</AppText>
          <AppText variant="bodyMedium" color={colors.textSecondary}>
            {summary}
          </AppText>
          {recommended ? <Badge label="Recomendado" color={colors.secondaryDark} /> : null}
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
});
