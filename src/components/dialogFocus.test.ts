// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { trapDialogFocus } from './dialogFocus';

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

function setup() {
  document.body.innerHTML = `
    <button id="before">Before</button>
    <div id="dialog" tabindex="-1">
      <button id="first">First</button>
      <input id="middle" />
      <button id="last">Last</button>
    </div>
    <button id="after">After</button>
  `;
  const dialog = document.getElementById('dialog') as HTMLElement;
  return {
    dialog,
    first: document.getElementById('first') as HTMLButtonElement,
    last: document.getElementById('last') as HTMLButtonElement,
  };
}

afterEach(cleanup);

describe('trapDialogFocus', () => {
  it('wraps Tab from the last control to the first', () => {
    const { dialog, first, last } = setup();
    last.focus();

    const event = keydown({ key: 'Tab' });
    trapDialogFocus(event, dialog);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    const { dialog, first, last } = setup();
    first.focus();

    const event = keydown({ key: 'Tab', shiftKey: true });
    trapDialogFocus(event, dialog);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('returns focus to the first control when Shift+Tab starts on the dialog', () => {
    const { dialog, last } = setup();
    dialog.focus();

    const event = keydown({ key: 'Tab', shiftKey: true });
    trapDialogFocus(event, dialog);

    expect(document.activeElement).toBe(last);
  });

  it('leaves non-Tab keys and middle controls alone', () => {
    const { dialog, first } = setup();
    first.focus();

    const escape = keydown({ key: 'Escape' });
    trapDialogFocus(escape, dialog);
    expect(escape.defaultPrevented).toBe(false);

    const tab = keydown({ key: 'Tab' });
    trapDialogFocus(tab, dialog);
    expect(tab.defaultPrevented).toBe(false);
  });
});
