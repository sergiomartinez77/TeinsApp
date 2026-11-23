import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import { ConnectivityBanner, ErrorScreen, LoadingScreen, ReadOnlyNotice } from '@/components/ui';
import { VisitReportButton } from '@/features/reports/components/VisitReportButton';
import { useVisitReport } from '@/features/reports/hooks/useVisitReport';
import { SectionGrid, type VisitSection } from '@/features/visits/components/SectionGrid';
import { VisitActionBar } from '@/features/visits/components/VisitActionBar';
import { VisitInfoCard } from '@/features/visits/components/VisitInfoCard';
import { useVisitActions } from '@/features/visits/hooks/useVisitActions';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { isOwnVisit, readOnlyVisitMessage, visitScopeFor } from '@/models/visit.model';
import { colors, contentWidths, isSplitViewWidth, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

const READ_ONLY_MESSAGE = 'La visita está cerrada: puedes consultarla, pero ya no editarla.';

/** Ruta `/visits/[visitId]` — detalle con acceso a las secciones de trabajo. */
export default function VisitDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const user = useRequiredUser();
  const isOnline = useConnectivity();

  const { visit, isLoading, hasError } = useVisit(visitScopeFor(user), visitId);
  const { start, complete } = useVisitActions();
  const report = useVisitReport(visitId);
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

  // Visita de otro técnico (admin/oficina): se consulta y se comparte su PDF,
  // pero no se inicia ni se finaliza (solo su técnico trabaja en ella).
  const own = isOwnVisit(visit, user.id);
  const readOnlyMessage = readOnlyVisitMessage(visit, user, READ_ONLY_MESSAGE);
  const info = (
    <>
      {readOnlyMessage ? <ReadOnlyNotice message={readOnlyMessage} /> : null}
      <VisitInfoCard visit={visit} currentUserId={user.id} />
    </>
  );
  const actions = (
    <>
      {own ? (
        <VisitActionBar
          status={visit.status}
          onStart={() => start.mutate(visit.id)}
          onComplete={confirmComplete}
          isBusy={start.isPending || complete.isPending}
        />
      ) : null}
      {/* Informe PDF: se genera en el teléfono, también sin conexión. */}
      <VisitReportButton onPress={report.shareReport} step={report.step} />
    </>
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
    maxWidth: contentWidths.wide,
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
