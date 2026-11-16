import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { photoSyncInfo, type PhotoSyncStatus } from '@/models/photo.model';
import { colors, radius } from '@/theme';

export interface SyncDotProps {
  status: PhotoSyncStatus;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Punto de color con el estado de subida de una foto. El estado también va
 * en la etiqueta accesible: no se depende solo del color.
 */
export function SyncDot({ status, size = 12, style }: SyncDotProps) {
  const info = photoSyncInfo(status);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={info.label}
      testID={`sync-dot-${status}`}
      style={[styles.dot, { width: size, height: size, backgroundColor: info.color }, style]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
});
