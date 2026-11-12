const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Keep Tab focus inside a dialog.
 *
 * Popovers are non-modal visually but behave like dialogs for keyboard users;
 * wrapping at both ends prevents focus from silently escaping behind the
 * trigger.
 */
export function trapDialogFocus(
  event: KeyboardEvent,
  container: HTMLElement | null,
): void {
  if (event.key !== 'Tab' || !container) return;

  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
