import { UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

// On a public link, creating a meeting needs an access code -- otherwise
// anyone who finds the address could start calls on our OpenAI bill.
// Joining needs only the meeting link, whose code is random and unguessable.
// ACCESS_CODE unset = no code needed (local development).
export function accessCodeRequired(): boolean {
  return !!process.env.ACCESS_CODE;
}

export function checkAccessCode(given: string | undefined): void {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return;
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  // Constant-time comparison, so the code can't be guessed by timing.
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new UnauthorizedException('Wrong access code');
}
