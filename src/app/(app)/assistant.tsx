import { useRouter } from 'expo-router';
import { useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import { AppText, ConnectivityBanner } from '@/components/ui';
import type { ChatMessage } from '@/features/assistant/assistant.store';
import { AssistantActions } from '@/features/assistant/components/AssistantActions';
import { ChatBubble, ENGINE_LABELS } from '@/features/assistant/components/ChatBubble';
import { ChatComposer } from '@/features/assistant/components/ChatComposer';
import { useAssistantChat } from '@/features/assistant/hooks/useAssistantChat';
import { ASSISTANT_WELCOME, DEFAULT_SUGGESTIONS } from '@/features/assistant/services/engine';
import { useConnectivity } from '@/hooks/useConnectivity';
import { colors, contentWidths, spacing } from '@/theme';

/** Ruta `/assistant` — chat con el asistente (básico sin conexión o con IA). */
export default function AssistantScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isOnline = useConnectivity();
  const chat = useAssistantChat();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const actionsFor = (message: ChatMessage) => (
    <AssistantActions
      actions={message.actions}
      disabled={chat.isSending}
      onSuggestion={chat.send}
      onSelectVisit={chat.chooseVisit}
      onOpenInventory={() => router.push('/inventory')}
    />
  );

  return (
    <View style={styles.screen}>
      <AppBar
        title="Asistente"
        subtitle={ENGINE_LABELS[chat.preferredEngine]}
        bottom={<ConnectivityBanner isOnline={isOnline} />}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={listRef}
          data={chat.messages}
          keyExtractor={(message) => message.id}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <ChatBubble message={item}>
              {item.role === 'assistant' && item.actions.length > 0 ? actionsFor(item) : null}
            </ChatBubble>
          )}
          ListHeaderComponent={
            <ChatBubble
              message={{ id: 'welcome', role: 'assistant', text: ASSISTANT_WELCOME, actions: [] }}
            >
              {chat.messages.length === 0
                ? actionsFor({
                    id: 'welcome',
                    role: 'assistant',
                    text: ASSISTANT_WELCOME,
                    actions: DEFAULT_SUGGESTIONS,
                  })
                : null}
            </ChatBubble>
          }
          ListFooterComponent={
            chat.isSending ? (
              <View
                style={styles.typing}
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel="El asistente está respondiendo"
                testID="assistant-typing"
              >
                <ActivityIndicator size="small" color={colors.primary} />
                <AppText variant="bodySmall" color={colors.textSecondary}>
                  Pensando…
                </AppText>
              </View>
            ) : undefined
          }
          contentContainerStyle={[
            styles.list,
            {
              paddingLeft: insets.left + spacing.screenHorizontal,
              paddingRight: insets.right + spacing.screenHorizontal,
            },
          ]}
        />
        <View
          style={[
            styles.composer,
            {
              paddingLeft: insets.left + spacing.screenHorizontal,
              paddingRight: insets.right + spacing.screenHorizontal,
              paddingBottom: insets.bottom + spacing.sm,
            },
          ]}
        >
          <View style={styles.composerContent}>
            <ChatComposer onSend={chat.send} isSending={chat.isSending} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  list: {
    gap: spacing.md,
    paddingTop: spacing.screenVertical,
    paddingBottom: spacing.md,
    width: '100%',
    maxWidth: contentWidths.form,
    alignSelf: 'center',
  },
  typing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  composer: {
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  composerContent: {
    width: '100%',
    maxWidth: contentWidths.form,
    alignSelf: 'center',
  },
});
