import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fab } from '@/components/ui';
import { colors, spacing } from '@/theme';

export interface PhotoFabsProps {
  /** Visita cerrada: no se muestran los botones. */
  readOnly: boolean;
  /** Mientras se procesa una captura no se puede iniciar otra. */
  disabled?: boolean;
  onCamera: () => void;
  onLibrary: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Dos botones flotantes: uno pequeño gris para elegir de la galería y el
 * principal azul para tomar una fotografía con la cámara.
 */
export function PhotoFabs({
  readOnly,
  disabled = false,
  onCamera,
  onLibrary,
  style,
}: PhotoFabsProps) {
  if (readOnly) return null;

  return (
    <View style={[styles.container, style]} pointerEvents="box-none">
      <Fab
        icon="photo-library"
        size="small"
        accessibilityLabel="Elegir de la galería"
        backgroundColor={colors.grey600}
        onPress={onLibrary}
        disabled={disabled}
        testID="photo-library-fab"
      />
      <Fab
        icon="photo-camera"
        accessibilityLabel="Tomar fotografía"
        onPress={onCamera}
        disabled={disabled}
        testID="photo-camera-fab"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
  },
});
