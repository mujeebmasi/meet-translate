import { LANGUAGES, canTranslate } from './languages';
import { TRANSLATORS } from './openai/translators';

describe('canTranslate', () => {
  it('translates Hindi and Telugu into English with every model', () => {
    for (const model of TRANSLATORS) {
      expect(canTranslate('hi', 'en', model)).toBe(true);
      expect(canTranslate('te', 'en', model)).toBe(true);
    }
  });

  it('translates between Hindi and Telugu with gpt-realtime-2 only', () => {
    expect(canTranslate('hi', 'te', 'gpt-realtime-2')).toBe(true);
    expect(canTranslate('te', 'hi', 'gpt-realtime-2')).toBe(true);
    expect(canTranslate('hi', 'te', 'gpt-realtime-translate')).toBe(false);
  });

  it('translates English into Hindi and Telugu with gpt-realtime-2 only', () => {
    expect(canTranslate('en', 'hi', 'gpt-realtime-2')).toBe(true);
    expect(canTranslate('en', 'te', 'gpt-realtime-2')).toBe(true);
    expect(canTranslate('en', 'hi', 'gpt-realtime-translate')).toBe(false);
    expect(canTranslate('en', 'te', 'gpt-realtime-translate')).toBe(false);
  });

  it('translates every other pair with Gemini too', () => {
    for (const pair of ['hi>te', 'te>hi', 'en>hi', 'en>te']) {
      const [from, to] = pair.split('>');
      expect(canTranslate(from, to, 'gemini-3.5-live-translate')).toBe(true);
    }
  });

  it('never translates a language into itself', () => {
    expect(canTranslate('hi', 'hi', 'gpt-realtime-2')).toBe(false);
    expect(canTranslate('en', 'en', 'gpt-realtime-2')).toBe(false);
  });

  it('offers only languages the OpenAI models accept', () => {
    expect(Object.keys(LANGUAGES)).toEqual(['en', 'hi', 'te']);
  });
});
