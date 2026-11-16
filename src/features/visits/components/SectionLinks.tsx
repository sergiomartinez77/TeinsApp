import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon } from '@/components/ui';
import { colors, radius, spacing, withAlpha } from '@/theme';

import type { SectionStatuses, SummarySection } from '../services/visit-summary';
import { VISIT_SECTIONS, type VisitSectionInfo } from './SectionGrid';

/** Secciones del resumen: todas menos el propio resumen. */
const SUMMARY_SECTIONS = VISIT_SECTIONS.filter(
  (section): section is VisitSectionInfo & { key: SummarySection } => section.key !== 'summary',
);

export interface SectionLinksProps {
  /** Línea de estado de cada sección. */
  statuses: SectionStatuses;
  onOpen: (section: SummarySection) => void;
}

/** Lista de secciones de la visita con su estado; cada fila abre su sección. */
export function SectionLinks({ statuses, onOpen }: SectionLinksProps) {
  return (
    <View style={styles.list}>
      {SUMMARY_SECTIONS.map((section) => {
        const status = statuses[section.key];
        return (
          <Card
            key={section.key}
            onPress={() => onOpen(section.key)}
            accessibilityLabel={`${section.label}: ${status}`}
            accessibilityHint="Abre la sección"
            testID={`section-link-${section.key}`}
          >
            <View style={styles.row}>
              <View style={[styles.iconBox, { backgroundColor: withAlpha(section.color, 0.12) }]}>
                <Icon name={section.icon} size={24} color={section.color} />
              </View>
              <View style={styles.texts}>
                <AppText variant="titleSmall" numberOfLines={2}>
                  {section.label}
                </AppText>
                <AppText variant="bodyMedium" color={colors.textSecondary}>
                  {status}
                </AppText>
              </View>
              <Icon name="chevron-right" size={24} color={colors.grey500} />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    gap: spacing.xs,
  },
});
