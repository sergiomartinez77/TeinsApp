import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import { ConnectivityBanner, ErrorScreen, LoadingScreen } from '@/components/ui';
import { SectionGrid, type VisitSection } from '@/features/visits/components/SectionGrid';
import { VisitActionBar } from '@/features/visits/components/VisitActionBar';
import { VisitInfoCard } from '@/features/visits/components/VisitInfoCard';
import { useVisitActions } from '@/features/visits/hooks/useVisitActions';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { colors, isSplitViewWidth, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

const CONTENT_MAX_WIDTH = 1100;

/** Ruta `/visits/[visitId]` — detalle con acceso a las secciones de trabajo. */
export default function VisitDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const user = useRequiredUser();
  const isOnline = useConnectivity();

  const { visit, isLoading, hasError } = useVisit(user.id, visitId);
  const { start, complete } = useVisitActions();
  const split = isSplitViewWidth(width);

  const openSection = (section: VisitSection) =>
    router.push({ pathname: `/visits/[visitId]/${section}`, params: { visitId } });

  const confirmComplete = () =>
    Alert.alert(
      'Finalizar visita',
      'Al finalizar, la visita queda cerrada y ya no se podrá editar. ¿Quieres finalizarla?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Finalizar', onPress: () => complete.mutate(visitId) },
      ],
    );

  const bar = <AppBar title="Visita" bottom={<ConnectivityBanner isOnline={isOnline} />} />;

  if (isLoading) {
    return (
      <View style={styles.screen}>
        {bar}
        <LoadingScreen message="Cargando visita..." />
      </View>
    );
  }

  if (hasError || !visit) {
    return (
      <View style={styles.screen}>
        {bar}
        <ErrorScreen
          message={hasError ? DEFAULT_ERROR_MESSAGES.database : VISIT_MESSAGES.notFound}
        />
      </View>
    );
  }

  const info = <VisitInfoCard visit={visit} />;
  const actions = (
    <VisitActionBar
      status={visit.status}
      onStart={() => start.mutate(visit.id)}
      onComplete={confirmComplete}
      isBusy={start.isPending || complete.isPending}
    />
  );
  const grid = <SectionGrid onOpen={openSection} />;

  return (
    <View style={styles.screen}>
      {bar}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingLeft: insets.left + spacing.screenHorizontal,
            paddingRight: insets.right + spacing.screenHorizontal,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        {split ? (
          // Tablet / horizontal: información y acciones a la izquierda, secciones a la derecha.
          <View style={[styles.content, styles.splitRow]}>
            <View style={styles.splitLeft}>
              {info}
              {actions}
            </View>
            <View style={styles.splitRight}>{grid}</View>
          </View>
        ) : (
          <View style={styles.content}>
            {info}
            {grid}
            {actions}
          </View>
        )}
      </ScrollView>
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
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    gap: spacing.md,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  splitLeft: {
    flex: 2,
    gap: spacing.md,
  },
  splitRight: {
    flex: 3,
  },
});
