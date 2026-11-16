import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui';
import { photoSyncInfo, type VisitPhoto } from '@/models/photo.model';
import { colors, radius, spacing } from '@/theme';
import { formatDateTime } from '@/utils/date.utils';

import { usePhotoSource } from '../hooks/usePhotoSource';

import { SyncDot } from './SyncDot';

export interface PhotoThumbnailProps {
  photo: VisitPhoto;
  /** Lado de la miniatura cuadrada, en dp. */
  size: number;
  onPress: (photo: VisitPhoto) => void;
  /** Si no se indica (visita cerrada), mantener pulsado no hace nada. */
  onLongPress?: (photo: VisitPhoto) => void;
}

/** Miniatura cuadrada de una foto con el punto de estado de subida en una esquina. */
export function PhotoThumbnail({ photo, size, onPress, onLongPress }: PhotoThumbnailProps) {
  const { source, isLoading } = usePhotoSource(photo);
  const status = photoSyncInfo(photo.syncStatus).label;
  const captured = formatDateTime(photo.capturedAt);

  return (
    <Pressable
      onPress={() => onPress(photo)}
      onLongPress={onLongPress ? () => onLongPress(photo) : undefined}
      accessibilityRole="imagebutton"
      accessibilityLabel={['Fotografía', captured, status].filter(Boolean).join(', ')}
      accessibilityHint={
        onLongPress ? 'Toca para verla. Mantén pulsado para eliminarla.' : 'Toca para verla.'
      }
      testID={`photo-${photo.id}`}
      style={({ pressed }) => [
        styles.tile,
        { width: size, height: size },
        pressed && styles.pressed,
      ]}
    >
      {source ? (
        <Image
          source={{ uri: source.uri, cacheKey: source.cacheKey }}
          recyclingKey={photo.id}
          contentFit="cover"
          // Se decodifica al tamaño de la miniatura (≈300 px), no a la resolución original.
          allowDownscaling
          style={styles.image}
          accessible={false}
        />
      ) : (
        <View style={styles.placeholder}>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="image-not-supported" size={32} color={colors.grey500} />
          )}
        </View>
      )}
      <SyncDot status={photo.syncStatus} style={styles.dot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.grey200,
  },
  pressed: {
    opacity: 0.8,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: spacing.xs + 2,
    right: spacing.xs + 2,
  },
});
