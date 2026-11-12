import type { SelectionMode } from '../types';

/**
 * Prompt shown in the toolbar for the active selection mode.
 *
 * The directional view is a two-step interaction: the first click pins the
 * origin and the second click aims the bearing. `hasPendingOrigin` lets the
 * prompt explain the second step, while a completed direction is described as
 * adjustable (drag the pin or start again).
 */
export interface SelectionInstructionInput {
  mode: SelectionMode;
  hasPerimeter: boolean;
  hasDirection: boolean;
  hasPendingOrigin: boolean;
}

export function selectionInstruction({
  mode,
  hasPerimeter,
  hasDirection,
  hasPendingOrigin,
}: SelectionInstructionInput): string {
  if (mode === 'direction') {
    if (hasPendingOrigin) {
      return 'Origin pinned — click again to aim the view.';
    }
    if (hasDirection) {
      return 'View set — drag the pin to move the origin, or click the map to start a new view.';
    }
    return 'Click the map to pin an origin, then click again to aim the view.';
  }

  return hasPerimeter
    ? 'Perimeter set — click two new corners to redraw.'
    : 'Click two corners on the map to draw your search box.';
}
