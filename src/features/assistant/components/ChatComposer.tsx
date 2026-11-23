import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { IconButton } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

import { MAX_QUESTION_LENGTH } from '../hooks/useAssistantChat';

export interface ChatComposerProps {
  onSend: (text: string) => void;
  /** Mientras el asistente responde no se puede enviar otra pregunta. */
  isSending: boolean;
}

/** Campo para escribir la pregunta y botón de enviar. */
export function ChatComposer({ onSend, isSending }: ChatComposerProps) {
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !isSending;

  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  return (
    <View style={styles.row}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Escribe tu pregunta…"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Pregunta para el asistente"
        maxLength={MAX_QUESTION_LENGTH}
        multiline
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={submit}
        style={styles.input}
        testID="assistant-input"
      />
      <IconButton
        icon="send"
        accessibilityLabel="Enviar pregunta"
        onPress={submit}
        disabled={!canSend}
        color={colors.primary}
        testID="assistant-send"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: spacing.minTouchTarget,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: 16,
  },
});
