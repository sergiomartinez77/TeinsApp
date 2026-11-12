import { StyleSheet, View } from 'react-native';

import { AppText, Card, IconButton } from '@/components/ui';
import { formatQuantityWithUnit, type VisitMaterial } from '@/models/material.model';
import { colors, spacing } from '@/theme';

export interface MaterialListTileProps {
  material: VisitMaterial;
  /** Visita cerrada: sin botones de editar ni quitar. */
  readOnly: boolean;
  onEdit: (material: VisitMaterial) => void;
  onRemove: (material: VisitMaterial) => void;
}

/** Material de la visita: código, nombre, cantidad con unidad y observaciones. */
export function MaterialListTile({ material, readOnly, onEdit, onRemove }: MaterialListTileProps) {
  const quantity = formatQuantityWithUnit(material.quantity, material.unit);

  return (
    <Card testID={`material-${material.id}`}>
      <View style={styles.row}>
        <View
          style={styles.info}
          accessible
          accessibilityRole="text"
          accessibilityLabel={[
            material.materialName,
            `código ${material.materialCode}`,
            quantity,
            material.observations,
          ]
            .filter(Boolean)
            .join(', ')}
        >
          <AppText variant="labelMedium">{material.materialCode}</AppText>
          <AppText variant="titleMedium">{material.materialName}</AppText>
          <AppText variant="bodyLarge" color={colors.primary} style={styles.quantity}>
            {quantity}
          </AppText>
          {material.observations ? (
            <AppText variant="bodySmall">{material.observations}</AppText>
          ) : null}
        </View>

        {readOnly ? null : (
          <View style={styles.actions}>
            <IconButton
              icon="edit"
              accessibilityLabel={`Editar ${material.materialName}`}
              color={colors.primary}
              onPress={() => onEdit(material)}
            />
            <IconButton
              icon="delete-outline"
              accessibilityLabel={`Quitar ${material.materialName}`}
              color={colors.error}
              onPress={() => onRemove(material)}
            />
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  info: {
    flex: 1,
    gap: spacing.xs,
  },
  quantity: {
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
