import { config } from '../src/config.js';
import { createSmtpTransport } from '../src/services/smtp.service.js';

interface CheckResult {
  senderId: string;
  ok: boolean;
  detail: string;
  elapsedMs: number;
}

async function checkSender(sender: (typeof config.SMTP_SENDERS_JSON)[number]): Promise<CheckResult> {
  const transport = createSmtpTransport(sender);
  const startedAt = Date.now();
  try {
    await transport.verify();
    return { senderId: sender.id, ok: true, detail: 'authenticated', elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const details = error as { code?: string; command?: string; message?: string };
    return {
      senderId: sender.id,
      ok: false,
      detail: `${details.code ?? 'ERROR'} at ${details.command ?? 'unknown'}`,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    transport.close();
  }
}

const results: CheckResult[] = [];
for (const sender of config.SMTP_SENDERS_JSON) {
  const result = await checkSender(sender);
  results.push(result);
  const label = result.ok ? 'OK  ' : 'FAIL';
  console.log(`${label} ${result.senderId} (${sender.host}:${sender.port}) ${result.detail} ${result.elapsedMs}ms`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  // A CONN-stage failure means TCP connected but the session stalled, usually a proxy blocking STARTTLS.
  if (failed.some((result) => result.detail.endsWith('at CONN'))) {
    console.error('\nA failure at CONN means the SMTP session stalled, not that credentials are wrong.');
    console.error('A VPN, endpoint agent, or firewall that blocks encrypted mail submission causes this.');
    console.error('Retry from a network and machine without SMTP interception. Do not disable TLS verification.');
  }
  process.exit(1);
}

console.log('\nAll senders reachable and authenticated.');
