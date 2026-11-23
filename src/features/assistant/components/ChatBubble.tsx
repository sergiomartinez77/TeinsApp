import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

import type { ChatMessage } from '../assistant.store';
import type { AssistantEngineKind } from '../services/engine';

export const ENGINE_LABELS: Readonly<Record<AssistantEngineKind, string>> = {
  local: 'Asistente básico · sin IA',
  claude: 'Asistente con IA (Claude)',
};

export interface ChatBubbleProps {
  message: ChatMessage;
  /** Acciones de la respuesta (debajo del texto). */
  children?: ReactNode;
}

/** Un mensaje del chat: el del usuario a la derecha, el del asistente a la izquierda. */
export function ChatBubble({ message, children }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[styles.bubble, isUser ? styles.user : styles.assistant]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${isUser ? 'Tú' : 'Asistente'}: ${message.text}`}
        testID={`chat-${message.role}`}
      >
        {message.notice ? (
          <View style={styles.notice}>
            <Icon name="cloud-off" size={16} color={colors.warning} />
            <AppText variant="bodySmall" color={colors.warning} style={styles.flex}>
              {message.notice}
            </AppText>
          </View>
        ) : null}
        <AppText variant="bodyMedium" color={isUser ? colors.onPrimary : colors.textPrimary}>
          {message.text}
        </AppText>
        {!isUser && message.engine ? (
          <AppText variant="labelSmall" color={colors.textSecondary}>
            {ENGINE_LABELS[message.engine]}
          </AppText>
        ) : null}
      </View>
      {children ? <View style={styles.extras}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    maxWidth: '100%',
  },
  rowUser: {
    alignItems: 'flex-end',
  },
  rowAssistant: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '88%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    gap: spacing.xs,
  },
  user: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.xs,
  },
  assistant: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  extras: {
    width: '100%',
  },
  flex: {
    flex: 1,
  },
});
