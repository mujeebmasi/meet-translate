import { LANGUAGES, canTranslate } from './languages';

describe('canTranslate', () => {
  it('translates Hindi and Telugu into English with either model', () => {
    for (const model of ['gpt-realtime-2', 'gpt-realtime-translate']) {
      expect(canTranslate('hi', 'en', model)).toBe(true);
      expect(canTranslate('te', 'en', model)).toBe(true);
    }
  });

  it('translates between Hindi and Telugu with gpt-realtime-2 only', () => {
    expect(canTranslate('hi', 'te', 'gpt-realtime-2')).toBe(true);
    expect(canTranslate('te', 'hi', 'gpt-realtime-2')).toBe(true);
    expect(canTranslate('hi', 'te', 'gpt-realtime-translate')).toBe(false);
  });

  it('never translates a language into itself, or English out', () => {
    expect(canTranslate('hi', 'hi', 'gpt-realtime-2')).toBe(false);
    expect(canTranslate('en', 'hi', 'gpt-realtime-2')).toBe(false);
  });

  it('offers only languages the OpenAI models accept', () => {
    expect(Object.keys(LANGUAGES)).toEqual(['en', 'hi', 'te']);
  });
});
