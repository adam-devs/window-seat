/** Join conditional class names without adding a runtime dependency. */
export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(' ');
}

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export const buttonBase = `inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-ink shadow-sm transition duration-200 hover:-translate-y-px hover:border-border-strong hover:bg-surface disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

export const compactButtonBase = `inline-flex items-center justify-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink transition duration-200 hover:border-border-strong hover:bg-surface disabled:pointer-events-none disabled:opacity-45 ${focusRing}`;

export const inputBase = `w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-ink placeholder:text-faint ${focusRing}`;

export const popoverBase = `absolute right-0 top-full z-[1200] mt-2 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-4 text-[13px] text-ink shadow-pop animate-pop-in max-[700px]:fixed max-[700px]:inset-x-3 max-[700px]:bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-[700px]:top-auto max-[700px]:mt-0 max-[700px]:max-h-[70dvh] max-[700px]:w-auto max-[700px]:max-w-none max-[700px]:overflow-y-auto max-[700px]:animate-sheet-up`;
