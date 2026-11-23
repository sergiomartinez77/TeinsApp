import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import { ConnectivityBanner, ErrorScreen, LoadingScreen, ReadOnlyNotice } from '@/components/ui';
import { SectionLinks } from '@/features/visits/components/SectionLinks';
import { VisitInfoCard } from '@/features/visits/components/VisitInfoCard';
import { useVisitSummary } from '@/features/visits/hooks/useVisitSummary';
import { useVisit } from '@/features/visits/hooks/useVisits';
import type { SummarySection } from '@/features/visits/services/visit-summary';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { readOnlyVisitMessage, visitScopeFor, type Visit } from '@/models/visit.model';
import { colors, contentWidths, isSplitViewWidth, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

const READ_ONLY_MESSAGE = 'La visita está cerrada: su contenido ya no se puede editar.';

/** Ruta `/visits/[visitId]/summary` — resumen de solo lectura de la visita. */
export default function VisitSummaryScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const user = useRequiredUser();
  const isOnline = useConnectivity();
  const { visit, isLoading, hasError } = useVisit(visitScopeFor(user), visitId);

  const bar = <AppBar title="Resumen" bottom={<ConnectivityBanner isOnline={isOnline} />} />;

  if (isLoading) {
    return (
      <View style={styles.screen}>
        {bar}
        <LoadingScreen message="Cargando resumen..." />
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

  return (
    <View style={styles.screen}>
      {bar}
      <SummaryContent userId={user.id} visit={visit} />
    </View>
  );
}

/** Contenido del resumen; separado para consultar las secciones solo con la visita cargada. */
function SummaryContent({ userId, visit }: { userId: string; visit: Visit }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const statuses = useVisitSummary(visit);
  const readOnlyMessage = readOnlyVisitMessage(visit, { id: userId }, READ_ONLY_MESSAGE);
  const split = isSplitViewWidth(width);

  const openSection = (section: SummarySection) =>
    router.push({ pathname: `/visits/[visitId]/${section}`, params: { visitId: visit.id } });

  const info = (
    <View style={styles.column}>
      {readOnlyMessage ? <ReadOnlyNotice message={readOnlyMessage} /> : null}
      <VisitInfoCard visit={visit} currentUserId={userId} />
    </View>
  );
  const links = <SectionLinks statuses={statuses} onOpen={openSection} />;

  return (
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
        // Tablet / horizontal: información a la izquierda, secciones a la derecha.
        <View style={[styles.content, styles.splitRow]}>
          <View style={styles.splitColumn}>{info}</View>
          <View style={styles.splitColumn}>{links}</View>
        </View>
      ) : (
        <View style={styles.content}>
          {info}
          {links}
        </View>
      )}
    </ScrollView>
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
  splitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  splitColumn: {
    flex: 1,
  },
  column: {
    gap: spacing.md,
  },
});
