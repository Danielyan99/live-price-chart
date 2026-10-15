import { useEffect, useRef } from "react";

/** Something outside React that draws into a DOM node it is given. */
export interface Mountable {
  mount(el: HTMLElement): void;
  unmount(): void;
}

/** Hands a DOM node to an engine view on mount and takes it back on unmount. */
export function useMount<T extends HTMLElement>(view: Mountable) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    view.mount(el);
    return () => view.unmount();
  }, [view]);
  return ref;
}
