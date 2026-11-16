import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Icon, IconButton } from '@/components/ui';
import { photoSyncInfo, type VisitPhoto } from '@/models/photo.model';
import { colors, spacing, withAlpha } from '@/theme';

import { usePhotoSource } from '../hooks/usePhotoSource';

import { SyncDot } from './SyncDot';
import { ZoomableImage } from './ZoomableImage';

/** Fondo del visor: el tono más oscuro de la paleta. */
const BLACK = colors.grey900;
const OVERLAY = withAlpha(colors.grey900, 0.6);

export interface PhotoViewerProps {
  photos: readonly VisitPhoto[];
  /** Total de fotos de la visita (para el contador "1 / N"). */
  total: number;
  initialIndex: number;
  /** Visita cerrada: sin botón de eliminar. */
  readOnly: boolean;
  onClose: () => void;
  onDelete: (photo: VisitPhoto) => void;
  /** Pide la siguiente página de fotos al llegar al final. */
  onEndReached?: () => void;
}

/**
 * Visor a pantalla completa: deslizamiento horizontal entre fotos, zoom con
 * pellizco y doble toque, contador, botón de eliminar (si la visita es
 * editable) y pie con el texto de la foto y su estado de subida.
 */
export function PhotoViewer({
  photos,
  total,
  initialIndex,
  readOnly,
  onClose,
  onDelete,
  onEndReached,
}: PhotoViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);

  const currentIndex = Math.max(0, Math.min(index, photos.length - 1));
  const current = photos[currentIndex];

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.root}>
        <FlatList
          data={photos}
          keyExtractor={(photo) => photo.id}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={currentIndex}
          getItemLayout={(_, itemIndex) => ({
            length: width,
            offset: width * itemIndex,
            index: itemIndex,
          })}
          onMomentumScrollEnd={handleScrollEnd}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          renderItem={({ item, index: itemIndex }) => (
            <ViewerPage
              photo={item}
              position={itemIndex + 1}
              width={width}
              height={height}
              active={itemIndex === currentIndex}
              onZoomChange={setZoomed}
            />
          )}
        />

        <View
          style={[
            styles.topBar,
            { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
          ]}
        >
          <IconButton
            icon="close"
            accessibilityLabel="Cerrar"
            color={colors.textInverse}
            onPress={onClose}
            testID="photo-viewer-close"
          />
          <AppText
            variant="titleMedium"
            color={colors.textInverse}
            style={styles.counter}
            accessibilityLabel={`Fotografía ${currentIndex + 1} de ${total}`}
          >
            {`${currentIndex + 1} / ${total}`}
          </AppText>
          {readOnly || !current ? null : (
            <IconButton
              icon="delete-outline"
              accessibilityLabel="Eliminar fotografía"
              color={colors.textInverse}
              onPress={() => {
                setZoomed(false);
                onDelete(current);
              }}
              testID="photo-viewer-delete"
            />
          )}
        </View>

        {current ? (
          <View
            style={[
              styles.footer,
              {
                paddingBottom: insets.bottom + spacing.md,
                paddingLeft: insets.left + spacing.md,
                paddingRight: insets.right + spacing.md,
              },
            ]}
          >
            {current.caption ? (
              <AppText variant="bodyLarge" color={colors.textInverse}>
                {current.caption}
              </AppText>
            ) : null}
            <View style={styles.status}>
              <SyncDot status={current.syncStatus} />
              <AppText
                variant="bodyMedium"
                color={colors.textInverse}
                importantForAccessibility="no"
                accessibilityElementsHidden
              >
                {photoSyncInfo(current.syncStatus).label}
              </AppText>
            </View>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

interface ViewerPageProps {
  photo: VisitPhoto;
  position: number;
  width: number;
  height: number;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
}

function ViewerPage({ photo, position, width, height, active, onZoomChange }: ViewerPageProps) {
  const { source, isLoading } = usePhotoSource(photo);

  if (!source) {
    return (
      <View style={[styles.page, { width, height }]}>
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.textInverse} />
        ) : (
          <View style={styles.unavailable}>
            <Icon name="image-not-supported" size={48} color={colors.grey400} />
            <AppText variant="bodyMedium" color={colors.grey400} align="center">
              La fotografía no está disponible sin conexión.
            </AppText>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.page, { width, height }]}>
      <ZoomableImage
        source={source}
        width={width}
        height={height}
        active={active}
        onZoomChange={onZoomChange}
        accessibilityLabel={`Fotografía ${position}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BLACK,
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLACK,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
    backgroundColor: OVERLAY,
  },
  counter: {
    flex: 1,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.sm,
    paddingTop: spacing.md,
    backgroundColor: OVERLAY,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  unavailable: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
});
