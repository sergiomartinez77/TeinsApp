import { Text, type TextProps } from 'react-native';

import { typography, type TypographyVariant } from '@/theme';

export interface AppTextProps extends TextProps {
  /** Estilo de la escala tipográfica. Por defecto `bodyMedium`. */
  variant?: TypographyVariant;
  /** Color que reemplaza al de la variante. */
  color?: string;
  align?: 'left' | 'center' | 'right';
}

/** Texto con la escala tipográfica TEINS. */
export function AppText({ variant = 'bodyMedium', color, align, style, ...rest }: AppTextProps) {
  return (
    <Text
      style={[
        typography[variant],
        color ? { color } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}
