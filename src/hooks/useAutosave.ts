import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { AUTOSAVE } from '@/constants/app.constants';
import { trackPendingWrite } from '@/services/powersync/pending-writes';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutosaveOptions<T> {
  /** Guarda el valor; devuelve `false` si no se pudo guardar. Nunca debe lanzar. */
  save: (value: T) => Promise<boolean>;
  /** Espera tras el último cambio. Por defecto 800 ms. */
  delayMs?: number;
}

export interface AutosaveControls<T> {
  status: AutosaveStatus;
  /** Registra un cambio y programa el guardado (un cambio nuevo reinicia la espera). */
  schedule: (value: T) => void;
  /** Guarda ya el último cambio pendiente, si lo hay. */
  flush: () => Promise<void>;
  /** Descarta el cambio pendiente sin guardarlo. */
  cancel: () => void;
}

/**
 * Autoguardado con espera (debounce).
 *
 * - Cada cambio cancela el temporizador anterior y programa uno nuevo.
 * - Al desmontar la pantalla o pasar la app a segundo plano se guarda de inmediato;
 *   el cierre de la base al terminar la sesión espera a ese guardado.
 * - Los guardados se encadenan: nunca se pisan y el último valor siempre gana.
 * - Si un guardado falla, el cambio queda pendiente para el siguiente intento.
 */
export function useAutosave<T>({
  save,
  delayMs = AUTOSAVE.formDebounceMs,
}: UseAutosaveOptions<T>): AutosaveControls<T> {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const saveRef = useRef(save);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ value: T } | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback((): Promise<void> => {
    clearTimer();
    const run = async () => {
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      setStatus('saving');
      let saved = false;
      try {
        saved = await saveRef.current(pending.value);
      } catch {
        saved = false;
      }
      if (!saved && pendingRef.current === null) pendingRef.current = pending;
      setStatus(saved ? 'saved' : 'error');
    };
    queueRef.current = queueRef.current.then(run);
    // Se registra al momento: si la pantalla se desmonta porque terminó la
    // sesión, el cierre de la base espera a este guardado.
    return trackPendingWrite(queueRef.current);
  }, [clearTimer]);

  const schedule = useCallback(
    (value: T) => {
      pendingRef.current = { value };
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, delayMs);
    },
    [clearTimer, delayMs, flush],
  );

  const cancel = useCallback(() => {
    clearTimer();
    pendingRef.current = null;
  }, [clearTimer]);

  // La app pasa a segundo plano: se guarda antes de que el sistema pueda cerrarla.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') void flush();
    });
    return () => subscription.remove();
  }, [flush]);

  // Al salir de la pantalla se guarda lo pendiente.
  useEffect(() => () => void flush(), [flush]);

  return { status, schedule, flush, cancel };
}
