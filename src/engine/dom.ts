/**
 * Writes text into an element by changing its existing Text node in place.
 * Setting `textContent` replaces the node (remove + insert), which makes the
 * browser redo more style and layout work; measured in a trace, that was
 * thousands of node insertions per second for the trades table.
 */
export function setText(el: HTMLElement | null | undefined, text: string): void {
  if (!el) return;
  const node = el.firstChild;
  if (node !== null && node.nodeType === Node.TEXT_NODE && node === el.lastChild) {
    if ((node as Text).data !== text) (node as Text).data = text;
  } else if (el.textContent !== text) {
    el.textContent = text;
  }
}
