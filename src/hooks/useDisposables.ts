import { useEffect } from "react";

interface Disposable {
  dispose(): void;
}

/** Releases GPU resources created in `useMemo` when they are replaced or the component unmounts. */
export function useDisposables(...items: Disposable[]) {
  useEffect(() => () => items.forEach((item) => item.dispose()), items); // eslint-disable-line react-hooks/exhaustive-deps
}
