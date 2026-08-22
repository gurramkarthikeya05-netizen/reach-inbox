import { describe, expect, it } from 'vitest';
import { classifySmtpFailure } from './smtp.service.js';

describe('classifySmtpFailure', () => {
  it('retries connection timeouts', () => {
    expect(classifySmtpFailure({ code: 'ETIMEDOUT', command: 'CONN' })).toBe('transient');
  });

  it('fails authentication errors without retrying', () => {
    expect(classifySmtpFailure({ code: 'EAUTH', responseCode: 535 })).toBe('permanent');
  });

  it('fails permanent SMTP responses without retrying', () => {
    expect(classifySmtpFailure({ code: 'EENVELOPE', responseCode: 550 })).toBe('permanent');
  });

  it('marks network failures during DATA as delivery-ambiguous', () => {
    expect(classifySmtpFailure({ code: 'ECONNRESET', command: 'DATA' })).toBe('ambiguous');
  });

  it('retries temporary SMTP responses', () => {
    expect(classifySmtpFailure({ code: 'EENVELOPE', responseCode: 421 })).toBe('transient');
  });
});