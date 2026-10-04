"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false en el servidor y durante la hidratación; true después, en el navegador.
 * Sirve para mostrar lo que depende de la billetera sin desajustes de hidratación.
 */
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
