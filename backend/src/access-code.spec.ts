import { UnauthorizedException } from '@nestjs/common';
import { accessCodeRequired, checkAccessCode } from './access-code';

describe('access code', () => {
  afterEach(() => delete process.env.ACCESS_CODE);

  it('needs no code when none is set (local development)', () => {
    expect(accessCodeRequired()).toBe(false);
    expect(() => checkAccessCode(undefined)).not.toThrow();
  });

  it('accepts the right code and rejects a wrong or missing one', () => {
    process.env.ACCESS_CODE = 'demo-2026';
    expect(accessCodeRequired()).toBe(true);
    expect(() => checkAccessCode('demo-2026')).not.toThrow();
    expect(() => checkAccessCode('demo-2025')).toThrow(UnauthorizedException);
    expect(() => checkAccessCode(undefined)).toThrow(UnauthorizedException);
  });
});
