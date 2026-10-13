import { estimateCostUsd } from './cost';

describe('estimateCostUsd', () => {
  it('prices audio in and out at their own rates', () => {
    const cost = estimateCostUsd({
      input_token_details: { audio_tokens: 1_000_000 },
      output_token_details: { audio_tokens: 1_000_000 },
    });
    expect(cost).toBeCloseTo(32 + 64);
  });

  it('charges cached tokens only at the cheap cached rate', () => {
    const cost = estimateCostUsd({
      input_token_details: {
        audio_tokens: 1_000_000,
        cached_tokens: 1_000_000,
      },
    });
    expect(cost).toBeCloseTo(0.4);
  });

  it('copes with missing fields', () => {
    expect(estimateCostUsd({})).toBe(0);
  });
});
