import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import { ConnectivityBanner, ErrorMessage, Icon, IconButton, LoadingScreen } from '@/components/ui';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { InProgressSection } from '@/features/home/components/InProgressSection';
import { QuickActions } from '@/features/home/components/QuickActions';
import { StatsRow } from '@/features/home/components/StatsRow';
import { SyncStatusCard } from '@/features/home/components/SyncStatusCard';
import { WelcomeHeader } from '@/features/home/components/WelcomeHeader';
import { useDashboard } from '@/features/home/hooks/useDashboard';
import { SyncIndicator } from '@/features/sync/components/SyncIndicator';
import { useSyncIssueCount } from '@/features/sync/hooks/useSyncIssueCount';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { canCreateVisit, firstName } from '@/models/user.model';
import { useAuthStore } from '@/store/auth.store';
import { colors, contentWidths, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

/** Ruta `/home` — dashboard del técnico. */
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useRequiredUser();
  const isOnline = useConnectivity();
  const isSubmitting = useAuthStore((state) => state.isSubmitting);
  const confirmSignOut = useSignOut();
  const dashboard = useDashboard(user.id);
  const rejectedCount = useSyncIssueCount();

  return (
    <View style={styles.screen}>
      <AppBar
        title="TEINS"
        showBack={false}
        leading={<Icon name="engineering" size={24} color={colors.onPrimary} />}
        actions={
          <>
            <SyncIndicator />
            <IconButton
              icon="logout"
              accessibilityLabel="Cerrar sesión"
              color={colors.onPrimary}
              disabled={isSubmitting}
              onPress={confirmSignOut}
            />
          </>
        }
        bottom={<ConnectivityBanner isOnline={isOnline} />}
      />

      {dashboard.isLoading ? (
        <LoadingScreen />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingLeft: insets.left + spacing.screenHorizontal,
              paddingRight: insets.right + spacing.screenHorizontal,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={dashboard.isRefreshing}
              onRefresh={dashboard.refresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          <View style={styles.content}>
            <WelcomeHeader name={firstName(user)} />
            <SyncStatusCard rejectedCount={rejectedCount} />

            {dashboard.hasError ? <ErrorMessage message={DEFAULT_ERROR_MESSAGES.database} /> : null}

            <StatsRow stats={dashboard.stats} />
            <InProgressSection
              visits={dashboard.inProgress}
              onOpenVisit={(visitId) =>
                router.push({ pathname: '/visits/[visitId]', params: { visitId } })
              }
              onSeeAll={() => router.push('/visits')}
            />
            <QuickActions
              onMyVisits={() => router.push('/visits')}
              onNewVisit={
                canCreateVisit(user.role)
                  ? () => router.push({ pathname: '/visits', params: { create: '1' } })
                  : undefined
              }
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingTop: spacing.screenVertical,
  },
  content: {
    width: '100%',
    maxWidth: contentWidths.list,
    alignSelf: 'center',
    gap: spacing.md,
  },
});
