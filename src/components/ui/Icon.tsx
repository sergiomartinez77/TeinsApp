import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';

import { colors } from '@/theme';

/** Nombres de iconos Material disponibles (los mismos que usaba la app original). */
export type IconName = ComponentProps<typeof MaterialIcons>['name'];

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Si se indica, el icono se anuncia a los lectores de pantalla. */
  accessibilityLabel?: string;
}

export function Icon({
  name,
  size = 24,
  color = colors.textPrimary,
  accessibilityLabel,
}: IconProps) {
  return (
    <MaterialIcons
      name={name}
      size={size}
      color={color}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no'}
    />
  );
}
