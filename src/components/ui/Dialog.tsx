import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, maxContentWidth, radius, spacing } from '@/theme';

import { AppText } from './AppText';

export interface DialogProps {
  visible: boolean;
  title: string;
  /** Se llama al pulsar fuera o el botón atrás de Android. */
  onDismiss: () => void;
  children: ReactNode;
  /** Botones al pie (normalmente "Cancelar" y la acción principal). */
  actions?: ReactNode;
  /** Impide cerrar pulsando fuera (p. ej. mientras se guarda). */
  dismissable?: boolean;
  /** Ancla el diálogo abajo, como hoja inferior. */
  position?: 'center' | 'bottom';
  testID?: string;
}

/**
 * Diálogo modal. En tablet queda centrado con ancho máximo de 480dp;
 * el contenido se desplaza si no cabe y se adapta al teclado.
 */
export function Dialog({
  visible,
  title,
  onDismiss,
  children,
  actions,
  dismissable = true,
  position = 'center',
  testID,
}: DialogProps) {
  const insets = useSafeAreaInsets();
  const dismiss = () => {
    if (dismissable) onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={position === 'bottom' ? 'slide' : 'fade'}
      statusBarTranslucent
      onRequestClose={dismiss}
      supportedOrientations={['portrait', 'landscape']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View
          style={[
            styles.backdrop,
            position === 'bottom' ? styles.bottom : styles.center,
            {
              paddingTop: insets.top + spacing.md,
              paddingBottom: position === 'bottom' ? 0 : insets.bottom + spacing.md,
              paddingLeft: insets.left + (position === 'bottom' ? 0 : spacing.md),
              paddingRight: insets.right + (position === 'bottom' ? 0 : spacing.md),
            },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismiss}
            accessibilityLabel="Cerrar"
            accessibilityRole="button"
            importantForAccessibility="no"
          />
          <View
            style={[
              styles.surface,
              position === 'bottom' && [
                styles.sheet,
                { paddingBottom: insets.bottom + spacing.md },
              ],
            ]}
            accessibilityViewIsModal
            testID={testID}
          >
            <AppText variant="titleLarge" accessibilityRole="header" style={styles.title}>
              {title}
            </AppText>
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {actions ? <View style={styles.actions}>{actions}</View> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  surface: {
    width: '100%',
    maxWidth: maxContentWidth,
    maxHeight: '100%',
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  sheet: {
    maxWidth: 640,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  title: {
    flexShrink: 0,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
