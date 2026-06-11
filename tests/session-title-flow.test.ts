import { describe, it, expect } from 'vitest';
import { createTitleFlowHarness } from './support/session-title-harness';

describe('session title flow', () => {
  it('updates title after first user message when generator succeeds', async () => {
    const harness = createTitleFlowHarness({ generatedTitle: 'Short Title' });
    await harness.runFirstMessage('Help me make a PPT');
    expect(harness.updatedTitle).toBe('Short Title');
  });

  it('does not update when generator fails', async () => {
    const harness = createTitleFlowHarness({ generatedTitle: null });
    await harness.runFirstMessage('Help me make a PPT');
    expect(harness.updatedTitle).toBe(null);
    expect(harness.hasAttempted).toBe(false);
  });

  it('does not override manual title changes', async () => {
    const harness = createTitleFlowHarness({
      generatedTitle: 'Short Title',
      latestTitle: 'Manual Title',
    });
    await harness.runFirstMessage('Help me make a PPT');
    expect(harness.updatedTitle).toBe(null);
    expect(harness.hasAttempted).toBe(false);
  });

  it('does not mark attempt when updateTitle returns false (session deleted during generation)', async () => {
    const harness = createTitleFlowHarness({
      generatedTitle: 'Short Title',
      updateTitleResult: false,
    });
    await harness.runFirstMessage('Help me make a PPT');
    // updatedTitle is null because updateTitle returned false
    expect(harness.updatedTitle).toBe(null);
    // hasAttempted must be false so next session start can retry
    expect(harness.hasAttempted).toBe(false);
  });
});
