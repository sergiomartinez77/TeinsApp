import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '@/components/layout/AppBar';
import {
  ConnectivityBanner,
  EmptyState,
  ErrorScreen,
  LoadingScreen,
  ReadOnlyNotice,
} from '@/components/ui';
import { PhotoFabs } from '@/features/photos/components/PhotoFabs';
import { PhotoThumbnail } from '@/features/photos/components/PhotoThumbnail';
import { PhotoViewer } from '@/features/photos/components/PhotoViewer';
import { usePhotoActions } from '@/features/photos/hooks/usePhotoActions';
import { useVisitPhotos } from '@/features/photos/hooks/useVisitPhotos';
import { renderPhotoStamp } from '@/features/photos/services/photo-stamp-renderer';
import { useVisit } from '@/features/visits/hooks/useVisits';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { photoCountLabel, type VisitPhoto } from '@/models/photo.model';
import { isEditable } from '@/models/visit.model';
import { colors, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

/** Ancho aproximado de cada miniatura para decidir las columnas. */
const TILE_TARGET_WIDTH = 160;
const GRID_GAP = spacing.xs;
/** Espacio bajo la cuadrícula para que los dos botones flotantes no tapen las últimas fotos. */
const FABS_CLEARANCE = 160;
const READ_ONLY_MESSAGE = 'La visita está cerrada: las fotografías son de solo lectura.';

/** 3 columnas en teléfono; más en pantallas anchas. */
function columnsFor(width: number): number {
  return Math.max(3, Math.floor(width / TILE_TARGET_WIDTH));
}

/** Ruta `/visits/[visitId]/photos` — galería de fotografías de la visita. */
export default function VisitPhotosScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const user = useRequiredUser();
  const isOnline = useConnectivity();

  const visitQuery = useVisit(user.id, visitId);
  const list = useVisitPhotos(visitId);
  // La marca (fecha, ubicación y título de la visita) se dibuja con Skia sobre cada foto.
  const { capture, remove } = usePhotoActions(visitId, {
    visitTitle: visitQuery.visit?.title,
    renderStamp: renderPhotoStamp,
  });

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const screen = (content: ReactNode) => (
    <View style={styles.screen}>
      <AppBar
        title="Fotografías"
        subtitle={list.isLoading ? undefined : photoCountLabel(list.total)}
        actions={
          capture.isPending ? (
            <ActivityIndicator
              size="small"
              color={colors.onPrimary}
              accessibilityLabel="Procesando fotografía"
              style={styles.busy}
            />
          ) : undefined
        }
        bottom={<ConnectivityBanner isOnline={isOnline} />}
      />
      {content}
    </View>
  );

  if (visitQuery.isLoading || list.isLoading) {
    return screen(<LoadingScreen message="Cargando fotografías..." />);
  }
  const { visit } = visitQuery;
  if (visitQuery.hasError || list.hasError || !visit) {
    const hasError = visitQuery.hasError || list.hasError;
    return screen(
      <ErrorScreen
        message={hasError ? DEFAULT_ERROR_MESSAGES.database : VISIT_MESSAGES.notFound}
        onRetry={list.hasError ? list.refresh : undefined}
      />,
    );
  }

  const readOnly = !isEditable(visit);

  const horizontalPadding = spacing.screenHorizontal;
  const available = width - insets.left - insets.right - horizontalPadding * 2;
  const columns = columnsFor(available);
  const tileSize = Math.floor((available - GRID_GAP * (columns - 1)) / columns);

  const confirmDelete = (photo: VisitPhoto) =>
    Alert.alert(
      'Eliminar fotografía',
      '¿Eliminar esta fotografía? Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () =>
            remove.mutate(photo.id, {
              // Sin fotos restantes, el visor se cierra.
              onSuccess: () => {
                if (list.photos.length <= 1) setViewerIndex(null);
              },
            }),
        },
      ],
    );

  return screen(
    <>
      <FlatList
        // Al cambiar las columnas (giro o pantalla ancha) la cuadrícula se vuelve a montar.
        key={`grid-${columns}`}
        data={list.photos}
        numColumns={columns}
        keyExtractor={(photo) => photo.id}
        renderItem={({ item, index }) => (
          <PhotoThumbnail
            photo={item}
            size={tileSize}
            onPress={() => setViewerIndex(index)}
            onLongPress={readOnly ? undefined : confirmDelete}
          />
        )}
        columnWrapperStyle={columns > 1 ? styles.row : undefined}
        ListHeaderComponent={
          readOnly ? (
            <ReadOnlyNotice message={READ_ONLY_MESSAGE} style={styles.notice} />
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyState
            icon="photo-camera"
            message="Sin fotografías"
            hint={
              readOnly
                ? 'No se tomaron fotografías en esta visita.'
                : 'Toca el botón de la cámara para tomar la primera fotografía o elige una de la galería.'
            }
          />
        }
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={[
          styles.list,
          {
            paddingLeft: insets.left + horizontalPadding,
            paddingRight: insets.right + horizontalPadding,
            paddingBottom: insets.bottom + FABS_CLEARANCE,
          },
        ]}
      />

      <PhotoFabs
        readOnly={readOnly}
        disabled={capture.isPending}
        onCamera={() => capture.mutate('camera')}
        onLibrary={() => capture.mutate('library')}
        style={[
          styles.fabs,
          { bottom: insets.bottom + spacing.md, right: insets.right + spacing.md },
        ]}
      />

      {viewerIndex !== null && list.photos.length > 0 ? (
        <PhotoViewer
          photos={list.photos}
          total={list.total}
          initialIndex={viewerIndex}
          readOnly={readOnly}
          onClose={() => setViewerIndex(null)}
          onDelete={confirmDelete}
          onEndReached={list.loadMore}
        />
      ) : null}
    </>,
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  busy: {
    marginRight: spacing.md,
  },
  list: {
    flexGrow: 1,
    paddingTop: spacing.screenVertical,
    gap: GRID_GAP,
  },
  row: {
    gap: GRID_GAP,
  },
  notice: {
    marginBottom: spacing.md,
  },
  fabs: {
    position: 'absolute',
  },
});
