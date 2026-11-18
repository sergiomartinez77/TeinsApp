import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Badge,
  Button,
  Card,
  Dialog,
  ErrorMessage,
  Icon,
  Input,
  Select,
} from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { CatalogMaterial } from '@/models/material.model';
import { colors, radius, spacing } from '@/theme';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

import type { NewCustomMaterialEntry, NewMaterialEntry } from '../hooks/useMaterialActions';
import { useMaterialsCatalog } from '../hooks/useMaterialsCatalog';
import {
  CUSTOM_MATERIAL_LIMITS,
  CUSTOM_UNIT_OPTIONS,
  CUSTOM_UNIT_OTHER,
  customMaterialSchema,
  materialEntrySchema,
  OBSERVATIONS_MAX_LENGTH,
  type CustomMaterialFormValues,
  type CustomMaterialInput,
  type MaterialEntryFormValues,
  type MaterialEntryInput,
} from '../validation';

export const SEARCH_DEBOUNCE_MS = 250;

export const ADD_MATERIAL_MESSAGES = {
  emptyCatalog:
    'El catálogo de materiales aún no está disponible. Conéctate a Internet para descargarlo.',
  noResults: (search: string) => `No hay materiales que coincidan con “${search}”.`,
  alreadyAdded: 'Ya agregado',
  addCustom: 'Agregar material que no está en el catálogo',
  customHint:
    'Solo se agrega a esta visita: el catálogo no cambia. Escribe el nombre y elige la unidad.',
  backToCatalog: 'Volver al catálogo',
} as const;

const DEFAULT_VALUES: MaterialEntryFormValues = { quantity: '', observations: '' };
const CUSTOM_DEFAULT_VALUES: CustomMaterialFormValues = {
  name: '',
  unit: '',
  otherUnit: '',
  quantity: '',
  observations: '',
};

/** Paso de la hoja: buscar en el catálogo, material elegido o material personalizado. */
type SheetStep = 'catalog' | 'selected' | 'custom';

export interface AddMaterialSheetProps {
  /** Materiales del catálogo que ya están en la visita: no se pueden repetir. */
  addedMaterialIds: ReadonlySet<string>;
  onDismiss: () => void;
  onSubmit: (entry: NewMaterialEntry) => void;
  /**
   * Material que no está en el catálogo (solo para esta visita). Sin esta
   * función no se ofrece la opción.
   */
  onSubmitCustom?: (entry: NewCustomMaterialEntry) => void;
  isSubmitting: boolean;
  /** Error al guardar, ya en español. */
  error?: string | null;
}

/**
 * Hoja inferior "Agregar material".
 * Paso 1: buscar y elegir en el catálogo. Paso 2: cantidad y observaciones.
 * Alternativa: "Agregar material que no está en el catálogo" abre un formulario
 * con nombre, unidad, cantidad y observaciones (solo para esta visita).
 */
export function AddMaterialSheet({
  addedMaterialIds,
  onDismiss,
  onSubmit,
  onSubmitCustom,
  isSubmitting,
  error,
}: AddMaterialSheetProps) {
  const [selected, setSelected] = useState<CatalogMaterial | null>(null);
  const [customMode, setCustomMode] = useState(false);
  // La búsqueda vive aquí para conservarla al volver a elegir otro material.
  const [searchText, setSearchText] = useState('');
  const { control, handleSubmit } = useForm<MaterialEntryFormValues, unknown, MaterialEntryInput>({
    resolver: zodResolver(materialEntrySchema),
    defaultValues: DEFAULT_VALUES,
  });
  const customForm = useForm<CustomMaterialFormValues, unknown, CustomMaterialInput>({
    resolver: zodResolver(customMaterialSchema),
    defaultValues: CUSTOM_DEFAULT_VALUES,
  });

  const step: SheetStep = customMode ? 'custom' : selected ? 'selected' : 'catalog';

  const submit = handleSubmit((values) => {
    if (selected) onSubmit({ materialId: selected.id, ...values });
  });
  const submitCustom = customForm.handleSubmit((values) => onSubmitCustom?.(values));

  return (
    <Dialog
      visible
      position="bottom"
      title={step === 'custom' ? 'Material fuera del catálogo' : 'Agregar material'}
      onDismiss={onDismiss}
      dismissable={!isSubmitting}
      testID="add-material-sheet"
      actions={
        <>
          <Button label="Cancelar" variant="text" onPress={onDismiss} disabled={isSubmitting} />
          {step === 'catalog' ? null : (
            <Button
              label="Agregar"
              icon="add"
              onPress={() => {
                void (step === 'custom' ? submitCustom() : submit());
              }}
              loading={isSubmitting}
              fullWidth={false}
            />
          )}
        </>
      }
    >
      {step === 'custom' ? (
        <>
          <CustomMaterialFields control={customForm.control} isSubmitting={isSubmitting} />
          <Button
            label={ADD_MATERIAL_MESSAGES.backToCatalog}
            variant="text"
            icon="chevron-left"
            onPress={() => setCustomMode(false)}
            disabled={isSubmitting}
          />
          {error ? <ErrorMessage message={error} /> : null}
        </>
      ) : selected ? (
        <>
          <Card style={styles.selected}>
            <View style={styles.selectedRow}>
              <View style={styles.flex}>
                <AppText variant="labelMedium">{selected.code}</AppText>
                <AppText variant="titleMedium">{selected.name}</AppText>
                <AppText variant="bodySmall">Unidad: {selected.unit}</AppText>
              </View>
              <Button
                label="Cambiar"
                variant="text"
                onPress={() => setSelected(null)}
                disabled={isSubmitting}
                accessibilityLabel="Cambiar material"
              />
            </View>
          </Card>

          <Controller
            control={control}
            name="quantity"
            render={({ field, fieldState }) => (
              <Input
                label="Cantidad"
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                keyboardType="decimal-pad"
                suffix={selected.unit}
                placeholder="Ej.: 12,5"
                editable={!isSubmitting}
              />
            )}
          />

          <Controller
            control={control}
            name="observations"
            render={({ field, fieldState }) => (
              <Input
                label="Observaciones"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                multiline
                maxLength={OBSERVATIONS_MAX_LENGTH}
                editable={!isSubmitting}
              />
            )}
          />

          {error ? <ErrorMessage message={error} /> : null}
        </>
      ) : (
        <CatalogPicker
          searchText={searchText}
          onSearchTextChange={setSearchText}
          addedMaterialIds={addedMaterialIds}
          onSelect={setSelected}
          onAddCustom={onSubmitCustom ? () => setCustomMode(true) : undefined}
        />
      )}
    </Dialog>
  );
}

interface CustomMaterialFieldsProps {
  control: Control<CustomMaterialFormValues, unknown, CustomMaterialInput>;
  isSubmitting: boolean;
}

/** Campos del material personalizado: nombre, unidad (u otra escrita), cantidad y observaciones. */
function CustomMaterialFields({ control, isSubmitting }: CustomMaterialFieldsProps) {
  const unit = useWatch({ control, name: 'unit' });
  const otherUnit = useWatch({ control, name: 'otherUnit' });
  const isOther = unit === CUSTOM_UNIT_OTHER;
  const suffix = isOther ? otherUnit.trim() : unit;

  return (
    <>
      <AppText variant="bodyMedium" color={colors.textSecondary}>
        {ADD_MATERIAL_MESSAGES.customHint}
      </AppText>

      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <Input
            label="Nombre del material"
            required
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            maxLength={CUSTOM_MATERIAL_LIMITS.nameMax}
            placeholder="Ej.: Abrazadera de acero de 2 pulgadas"
            editable={!isSubmitting}
          />
        )}
      />

      <Controller
        control={control}
        name="unit"
        render={({ field, fieldState }) => (
          <Select
            label="Unidad"
            required
            options={CUSTOM_UNIT_OPTIONS}
            value={field.value || null}
            onChange={field.onChange}
            error={fieldState.error?.message}
            disabled={isSubmitting}
            placeholder="Elige la unidad"
            testID="custom-material-unit"
          />
        )}
      />

      {isOther ? (
        <Controller
          control={control}
          name="otherUnit"
          render={({ field, fieldState }) => (
            <Input
              label="Escribe la unidad"
              required
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              maxLength={CUSTOM_MATERIAL_LIMITS.unitMax}
              placeholder="Ej.: bolsa"
              autoCapitalize="none"
              editable={!isSubmitting}
            />
          )}
        />
      ) : null}

      <Controller
        control={control}
        name="quantity"
        render={({ field, fieldState }) => (
          <Input
            label="Cantidad"
            required
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            keyboardType="decimal-pad"
            suffix={suffix || undefined}
            placeholder="Ej.: 12,5"
            editable={!isSubmitting}
          />
        )}
      />

      <Controller
        control={control}
        name="observations"
        render={({ field, fieldState }) => (
          <Input
            label="Observaciones"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            multiline
            maxLength={OBSERVATIONS_MAX_LENGTH}
            editable={!isSubmitting}
          />
        )}
      />
    </>
  );
}

interface CatalogPickerProps {
  searchText: string;
  onSearchTextChange: (text: string) => void;
  addedMaterialIds: ReadonlySet<string>;
  onSelect: (material: CatalogMaterial) => void;
  onAddCustom?: () => void;
}

/** Búsqueda en el catálogo, lista de resultados y acceso al material personalizado. */
function CatalogPicker({
  searchText,
  onSearchTextChange,
  addedMaterialIds,
  onSelect,
  onAddCustom,
}: CatalogPickerProps) {
  const search = useDebouncedValue(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const catalog = useMaterialsCatalog(search);

  const message = catalog.hasError
    ? DEFAULT_ERROR_MESSAGES.database
    : catalog.materials.length > 0
      ? null
      : search
        ? ADD_MATERIAL_MESSAGES.noResults(search)
        : ADD_MATERIAL_MESSAGES.emptyCatalog;

  return (
    <>
      <Input
        label="Buscar material"
        value={searchText}
        onChangeText={onSearchTextChange}
        placeholder="Código o nombre"
        leftIcon="search"
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
      />

      {onAddCustom ? (
        <Button
          label={ADD_MATERIAL_MESSAGES.addCustom}
          variant="outlined"
          icon="edit-note"
          onPress={onAddCustom}
          testID="add-custom-material"
        />
      ) : null}

      {catalog.isLoading ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Cargando catálogo" />
      ) : message ? (
        <AppText variant="bodyMedium" color={colors.textSecondary} align="center">
          {message}
        </AppText>
      ) : (
        // El cuerpo del diálogo ya se desplaza: los resultados se pintan sin lista anidada.
        <View style={styles.results}>
          {catalog.materials.map((material) => (
            <CatalogRow
              key={material.id}
              material={material}
              added={addedMaterialIds.has(material.id)}
              onSelect={onSelect}
            />
          ))}
          {catalog.hasMore ? (
            <Button label="Cargar más" variant="outlined" onPress={catalog.loadMore} />
          ) : null}
        </View>
      )}
    </>
  );
}

interface CatalogRowProps {
  material: CatalogMaterial;
  added: boolean;
  onSelect: (material: CatalogMaterial) => void;
}

function CatalogRow({ material, added, onSelect }: CatalogRowProps) {
  return (
    <Pressable
      onPress={() => onSelect(material)}
      disabled={added}
      accessibilityRole="button"
      accessibilityLabel={
        added
          ? `${material.name}, ${ADD_MATERIAL_MESSAGES.alreadyAdded.toLowerCase()}`
          : `${material.name}, código ${material.code}`
      }
      accessibilityState={{ disabled: added }}
      style={({ pressed }) => [
        styles.row,
        added && styles.rowDisabled,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.flex}>
        <AppText variant="labelMedium">{material.code}</AppText>
        <AppText
          variant="bodyLarge"
          color={added ? colors.textSecondary : colors.textPrimary}
          numberOfLines={2}
        >
          {material.name}
        </AppText>
        <AppText variant="bodySmall">{material.unit}</AppText>
      </View>
      {added ? (
        <Badge label={ADD_MATERIAL_MESSAGES.alreadyAdded} color={colors.textSecondary} />
      ) : (
        <Icon name="chevron-right" size={24} color={colors.textSecondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  selected: {
    backgroundColor: colors.surfaceVariant,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  results: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.minTouchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  rowDisabled: {
    backgroundColor: colors.grey100,
  },
  rowPressed: {
    backgroundColor: colors.surfaceVariant,
  },
});
