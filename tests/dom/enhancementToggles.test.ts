/**
 * @file enhancementToggles.test.ts
 * @description enhancement settings toggles 测试
 * @module tests/dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initEnhancementToggles } from '../../apps/extension/src/dashboard/tabs/settings/enhancement/settings/enhancementToggles';
import { updateAllToggleStates } from '../../apps/extension/src/dashboard/tabs/settings/enhancement/ui/enhancementHover';

function createHost() {
  return {
    enhancementTogglesInitialized: false,
    handleSubSettingsToggle: vi.fn(),
    emit: vi.fn(),
    scheduleAutoSave: vi.fn(),
    updateTranslationConfigVisibility: vi.fn(),
  };
}

describe('enhancement settings toggles', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps always-on toggles enabled after initialization and click attempts', () => {
    document.body.innerHTML = `
      <section id="enhancement-settings">
        <input type="checkbox" id="enableListDisplayControl">
        <button class="enhancement-toggle" data-target="enableListDisplayControl" data-always-on="true"></button>
      </section>
    `;
    const host = createHost();
    const checkbox = document.getElementById('enableListDisplayControl') as HTMLInputElement;
    const toggle = document.querySelector('.enhancement-toggle') as HTMLButtonElement;

    initEnhancementToggles(host);

    expect(checkbox.checked).toBe(true);
    expect(toggle.classList.contains('active')).toBe(true);
    expect(toggle.classList.contains('always-on')).toBe(true);
    expect(toggle.disabled).toBe(true);

    toggle.click();

    expect(checkbox.checked).toBe(true);
    expect(toggle.classList.contains('active')).toBe(true);
    expect(host.scheduleAutoSave).not.toHaveBeenCalled();

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(checkbox.checked).toBe(true);
    expect(toggle.classList.contains('active')).toBe(true);
  });

  it('keeps regular toggles interactive', () => {
    document.body.innerHTML = `
      <section id="enhancement-settings">
        <input type="checkbox" id="enableStatusQuickAction" checked>
        <button class="enhancement-toggle" data-target="enableStatusQuickAction"></button>
      </section>
    `;
    const host = createHost();
    const checkbox = document.getElementById('enableStatusQuickAction') as HTMLInputElement;
    const toggle = document.querySelector('.enhancement-toggle') as HTMLButtonElement;

    initEnhancementToggles(host);
    toggle.click();

    expect(checkbox.checked).toBe(false);
    expect(toggle.classList.contains('active')).toBe(false);
    expect(host.handleSubSettingsToggle).toHaveBeenCalledWith('enableStatusQuickAction', false);
    expect(host.scheduleAutoSave).toHaveBeenCalledTimes(1);
  });

  it('binds replacement toggle nodes after the settings page remounts', () => {
    document.body.innerHTML = `
      <section id="enhancement-settings">
        <input type="checkbox" id="enableStatusQuickAction">
        <button class="enhancement-toggle" data-target="enableStatusQuickAction"></button>
      </section>
    `;
    const host = createHost();

    initEnhancementToggles(host);

    document.body.innerHTML = `
      <section id="enhancement-settings">
        <input type="checkbox" id="enableStatusQuickAction">
        <button class="enhancement-toggle" data-target="enableStatusQuickAction"></button>
      </section>
    `;
    const replacementCheckbox = document.getElementById('enableStatusQuickAction') as HTMLInputElement;
    const replacementToggle = document.querySelector('.enhancement-toggle') as HTMLButtonElement;

    initEnhancementToggles(host);
    replacementToggle.click();

    expect(replacementCheckbox.checked).toBe(true);
    expect(host.scheduleAutoSave).toHaveBeenCalledTimes(1);
  });

  it('keeps always-on toggles enabled during global toggle refresh', () => {
    document.body.innerHTML = `
      <section id="enhancement-settings">
        <input type="checkbox" id="enableListDisplayControl">
        <button class="enhancement-toggle" data-target="enableListDisplayControl" data-always-on="true"></button>
      </section>
    `;
    const host = createHost();
    const checkbox = document.getElementById('enableListDisplayControl') as HTMLInputElement;
    const toggle = document.querySelector('.enhancement-toggle') as HTMLButtonElement;

    updateAllToggleStates(host);

    expect(checkbox.checked).toBe(true);
    expect(toggle.classList.contains('active')).toBe(true);
    expect(toggle.classList.contains('always-on')).toBe(true);
    expect(toggle.disabled).toBe(true);
    expect(host.handleSubSettingsToggle).toHaveBeenCalledWith('enableListDisplayControl', true);
  });
});
