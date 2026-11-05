import { presetDocument } from '@asobiba/sdk';
import { expect, it, vi } from 'vitest';
import { jinchi } from '../game';
import { previewMatch } from './index';

it('returns an intermediate position when the preview time budget expires', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(2000);
  try {
    const view = previewMatch(presetDocument(jinchi), 'end', 1);
    expect(view.phase).toBe('playing');
    expect((view.game as { lastMove: unknown }).lastMove).toBeNull();
    expect(view.lastRound).toBeNull();
  } finally { clock.mockRestore(); }
});
