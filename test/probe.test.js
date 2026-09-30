import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, resolvePublic, probeEntry, recordResult, reportSignature } from '../scripts/lib/probe.js';

test('monitor rejects private, link-local, mapped and mixed DNS answers', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(resolvePublic(new URL('https://public.example.org'), async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]), /UNSAFE_ADDRESS/);
});

test('monitor stops before requesting an unregistered redirect or HTTPS downgrade', async () => {
  for (const [location, reason] of [['https://other.example.org', 'UNREGISTERED_HOST'], ['http://www.python.org', 'HTTPS_DOWNGRADE'], ['http://169.254.169.254/', 'UNSAFE_REDIRECT']]) {
    let calls = 0;
    const result = await probeEntry({ url: 'https://www.python.org' }, ['www.python.org'], async () => { calls++; return { status: 302, location }; });
    assert.equal(result.reason, reason);
    assert.equal(calls, 1);
  }
});

test('same-host redirects are bounded and a later success resets failure history', async () => {
  const ok = await probeEntry({ url: 'https://www.python.org' }, ['www.python.org'], async (url) => url.pathname === '/' ? { status: 302, location: '/downloads/' } : { status: 200 });
  assert.equal(ok.level, 'ok');
  assert.equal(ok.chain.length, 2);
  const loop = await probeEntry({ url: 'https://www.python.org' }, ['www.python.org'], async () => ({ status: 302, location: '/' }));
  assert.equal(loop.reason, 'TOO_MANY_REDIRECTS');
  assert.equal(loop.chain.length, 4);
  const context = { key: 'python/home', url: 'https://www.python.org', probe_region: 'test' };
  const first = recordResult({ level: 'error', reason: 'HTTP_403' }, null, context);
  assert.equal(first.actionable, false);
  const second = recordResult({ level: 'error', reason: 'HTTP_403' }, first, context);
  assert.equal(second.actionable, true);
  assert.equal(recordResult(ok, second, context).failures, 0);
  assert.equal(recordResult({ level: 'error' }, second, { ...context, probe_region: 'other' }).failures, 1);
  assert.equal(recordResult({ level: 'error' }, second, { ...context, url: 'https://new.python.org' }).failures, 1);
});

test('notification signature ignores repeat counts and timestamps but captures meaningful changes', () => {
  const row = { key: 'python/home', actionable: true, reason: 'HTTP_403', url: 'https://www.python.org', failures: 2 };
  assert.equal(reportSignature([row]), reportSignature([{ ...row, failures: 3, checked_at: 'later' }]));
  assert.notEqual(reportSignature([row]), reportSignature([]));
});
