import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { IconButton } from '@/components/ui/IconButton';
import { colors, spacing } from '@/theme';

export const APP_BAR_HEIGHT = 56;

export interface AppBarProps {
  title: string;
  /** Texto pequeño bajo el título (p. ej. el conteo de fotos). */
  subtitle?: string;
  /** Muestra el botón atrás. Por defecto sí. */
  showBack?: boolean;
  /** Acción del botón atrás. Por defecto vuelve a la pantalla anterior. */
  onBack?: () => void;
  /** Contenido a la izquierda cuando no hay botón atrás (p. ej. el logo). */
  leading?: ReactNode;
  /** Acciones a la derecha (botones de icono, indicadores). */
  actions?: ReactNode;
  /** Contenido bajo la barra: banner de conexión, buscador, pestañas. */
  bottom?: ReactNode;
  backgroundColor?: string;
  foregroundColor?: string;
}

/**
 * Barra superior TEINS: fondo azul primario, texto blanco, sin sombra,
 * título alineado a la izquierda. Respeta el área segura superior.
 */
export function AppBar({
  title,
  subtitle,
  showBack = true,
  onBack,
  leading,
  actions,
  bottom,
  backgroundColor = colors.primary,
  foregroundColor = colors.onPrimary,
}: AppBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <View style={{ backgroundColor }}>
      <View
        style={[
          styles.bar,
          {
            marginTop: insets.top,
            paddingLeft: Math.max(insets.left, showBack ? spacing.xs : spacing.md),
            paddingRight: Math.max(insets.right, spacing.xs),
          },
        ]}
      >
        {showBack ? (
          <IconButton
            icon="arrow-back"
            accessibilityLabel="Volver"
            color={foregroundColor}
            onPress={handleBack}
            testID="app-bar-back"
          />
        ) : (
          leading
        )}

        <View style={styles.titles}>
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            color={foregroundColor}
            style={styles.title}
          >
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="bodySmall" numberOfLines={1} color={foregroundColor}>
              {subtitle}
            </AppText>
          ) : null}
        </View>

        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {bottom}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: APP_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  titles: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
