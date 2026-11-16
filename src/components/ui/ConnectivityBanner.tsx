import { useEffect, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';

import { UI } from '@/constants/app.constants';
import { colors, spacing } from '@/theme';

import { Icon } from './Icon';

export const CONNECTIVITY_BANNER_HEIGHT = 28;

export const CONNECTIVITY_MESSAGES = {
  online: 'Conectado',
  offline: 'Sin conexión — trabajando localmente',
} as const;

export interface ConnectivityBannerProps {
  isOnline: boolean;
}

/**
 * Barra de 28dp bajo la barra superior: verde con conexión, roja sin ella.
 * Trabajar sin conexión es un estado normal, no un error: solo informa.
 * El color cambia con una transición suave.
 */
export function ConnectivityBanner({ isOnline }: ConnectivityBannerProps) {
  const [progress] = useState(() => new Animated.Value(isOnline ? 1 : 0));

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: isOnline ? 1 : 0,
      duration: UI.animationMs,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [isOnline, progress]);

  const backgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.offline, colors.online],
  });

  const message = isOnline ? CONNECTIVITY_MESSAGES.online : CONNECTIVITY_MESSAGES.offline;

  return (
    <Animated.View
      style={[styles.banner, { backgroundColor }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      testID="connectivity-banner"
    >
      <Icon name={isOnline ? 'cloud-done' : 'wifi-off'} size={14} color={colors.textInverse} />
      <Animated.Text style={styles.text} numberOfLines={1}>
        {message}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    height: CONNECTIVITY_BANNER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  text: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '600',
  },
});
