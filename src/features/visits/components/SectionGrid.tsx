import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, type IconName } from '@/components/ui';
import { colors, radius, spacing, withAlpha } from '@/theme';

/** Secciones de trabajo de una visita. */
export type VisitSection = 'form-select' | 'materials' | 'photos' | 'annotations' | 'summary';

export interface VisitSectionInfo {
  key: VisitSection;
  label: string;
  icon: IconName;
  color: string;
}

export const VISIT_SECTIONS: readonly VisitSectionInfo[] = [
  { key: 'form-select', label: 'Formulario técnico', icon: 'assignment', color: colors.primary },
  { key: 'materials', label: 'Materiales', icon: 'inventory-2', color: colors.secondaryDark },
  { key: 'photos', label: 'Fotografías', icon: 'photo-camera', color: colors.warning },
  { key: 'annotations', label: 'Anotaciones', icon: 'draw', color: colors.info },
  { key: 'summary', label: 'Resumen', icon: 'summarize', color: colors.grey600 },
];

export interface SectionGridProps {
  onOpen: (section: VisitSection) => void;
  /** Secciones a mostrar. Por defecto todas. */
  sections?: readonly VisitSectionInfo[];
}

/** Accesos a las secciones de la visita, en cuadrícula de dos columnas. */
export function SectionGrid({ onOpen, sections = VISIT_SECTIONS }: SectionGridProps) {
  return (
    <View style={styles.grid}>
      {sections.map((section) => (
        <Card
          key={section.key}
          onPress={() => onOpen(section.key)}
          accessibilityLabel={section.label}
          style={styles.item}
          testID={`section-${section.key}`}
        >
          <View style={[styles.iconBox, { backgroundColor: withAlpha(section.color, 0.12) }]}>
            <Icon name={section.icon} size={26} color={section.color} />
          </View>
          <AppText variant="titleSmall" numberOfLines={2}>
            {section.label}
          </AppText>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  item: {
    // Dos columnas: cada tarjeta ocupa algo menos de la mitad para dejar el hueco.
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.sm,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
