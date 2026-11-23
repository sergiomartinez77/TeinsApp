import { usePowerSync } from '@powersync/react';
import { useMutation } from '@tanstack/react-query';

import { useRequiredUser } from '@/hooks/useCurrentUser';
import type { StockMovement } from '@/models/inventory.model';
import type { AppError } from '@/types/errors';
import { unwrapResult as unwrap } from '@/utils/result.utils';

import {
  recordStockMovement,
  setMinStock,
  type RecordStockMovementInput,
  type SetMinStockInput,
} from '../services/inventory.service';

/**
 * Acciones de bodega (admin/oficina). Escriben primero en la base local
 * (funcionan sin conexión) y se suben al sincronizar.
 */
export function useInventoryActions() {
  const db = usePowerSync();
  const user = useRequiredUser();

  const recordMovement = useMutation<StockMovement, AppError, RecordStockMovementInput>({
    mutationFn: (input) => unwrap(recordStockMovement(db, user, input)),
  });

  const updateMinStock = useMutation<void, AppError, SetMinStockInput>({
    mutationFn: (input) => unwrap(setMinStock(db, user, input)),
  });

  return {
    recordMovement,
    updateMinStock,
    isBusy: recordMovement.isPending || updateMinStock.isPending,
  };
}
