import { useAppStore } from "../stores/appStore";

/**
 * Access the current Rig instance from any component.
 *
 * Returns `null` when no backend is connected yet (before rehydration).
 * Components should guard on `rig !== null` before calling rig methods.
 */
export const useRig = () => useAppStore((s) => s.rig);
