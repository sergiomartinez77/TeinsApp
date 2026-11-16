import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { PhotoImageSource } from '../hooks/usePhotoSource';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

export interface ZoomableImageProps {
  source: PhotoImageSource;
  width: number;
  height: number;
  /** Al dejar de ser la foto visible, el zoom se reinicia. */
  active: boolean;
  /** Avisa si la imagen está ampliada (para bloquear el deslizamiento entre fotos). */
  onZoomChange?: (zoomed: boolean) => void;
  accessibilityLabel?: string;
}

/**
 * Imagen con zoom por pellizco y doble toque, y desplazamiento cuando está
 * ampliada. Al dejar de ser la foto visible se vuelve a montar, así el zoom
 * se reinicia al cambiar de foto.
 */
export function ZoomableImage(props: ZoomableImageProps) {
  return <ZoomableImageContent key={props.active ? 'active' : 'inactive'} {...props} />;
}

function ZoomableImageContent({
  source,
  width,
  height,
  active,
  onZoomChange,
  accessibilityLabel,
}: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const reportZoom = (value: boolean) => {
    setZoomed(value);
    onZoomChange?.(value);
  };

  const pinch = usePinchGesture({
    onUpdate: (event) => {
      'worklet';
      scale.set(Math.min(MAX_SCALE, Math.max(1, savedScale.get() * event.scale)));
    },
    onDeactivate: () => {
      'worklet';
      const value = scale.get();
      savedScale.set(value);
      if (value <= 1.01) {
        scale.set(withTiming(1));
        savedScale.set(1);
        translateX.set(withTiming(0));
        translateY.set(withTiming(0));
        savedX.set(0);
        savedY.set(0);
      }
      scheduleOnRN(reportZoom, value > 1.01);
    },
  });

  const pan = usePanGesture({
    enabled: zoomed && active,
    onUpdate: (event) => {
      'worklet';
      const limitX = ((scale.get() - 1) * width) / 2;
      const limitY = ((scale.get() - 1) * height) / 2;
      translateX.set(Math.min(limitX, Math.max(-limitX, savedX.get() + event.translationX)));
      translateY.set(Math.min(limitY, Math.max(-limitY, savedY.get() + event.translationY)));
    },
    onDeactivate: () => {
      'worklet';
      savedX.set(translateX.get());
      savedY.set(translateY.get());
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      'worklet';
      const next = scale.get() > 1 ? 1 : DOUBLE_TAP_SCALE;
      scale.set(withTiming(next));
      savedScale.set(next);
      translateX.set(withTiming(0));
      translateY.set(withTiming(0));
      savedX.set(0);
      savedY.set(0);
      scheduleOnRN(reportZoom, next > 1);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      { scale: scale.get() },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[{ width, height }, styles.container]}>
        <Animated.View style={[styles.image, animatedStyle]}>
          <Image
            source={{ uri: source.uri, cacheKey: source.cacheKey }}
            contentFit="contain"
            style={styles.image}
            accessible
            accessibilityLabel={accessibilityLabel}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
