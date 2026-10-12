import { LANGUAGES, needsTranslation } from './languages';

describe('needsTranslation', () => {
  it('translates a Hindi or Telugu speaker for an English listener', () => {
    expect(needsTranslation('hi', 'en')).toBe(true);
    expect(needsTranslation('te', 'en')).toBe(true);
  });

  it('never translates an English speaker, or for a non-English listener', () => {
    expect(needsTranslation('en', 'en')).toBe(false);
    expect(needsTranslation('en', 'hi')).toBe(false);
    expect(needsTranslation('te', 'hi')).toBe(false);
  });

  it('offers only languages the OpenAI translator accepts', () => {
    expect(Object.keys(LANGUAGES)).toEqual(['en', 'hi', 'te']);
  });
});
