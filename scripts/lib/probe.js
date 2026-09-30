import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { parseWebUrl } from '../../src/search.js';

const blockedV4 = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blockedV4.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) blockedV6.addSubnet(address, prefix, 'ipv6');

export function publicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blockedV4.check(address, 'ipv4') :
    family === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}

export async function resolvePublic(url, resolver = lookup) {
  if (!parseWebUrl(url.href)) throw new Error('UNSAFE_URL');
  let timer;
  const addresses = await Promise.race([
    resolver(url.hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), 5000); }),
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('UNSAFE_ADDRESS');
  return addresses;
}

export async function requestHeaders(url) {
  const addresses = await resolvePublic(url);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method: 'GET', maxHeaderSize: 16384,
      headers: { 'user-agent': 'OfficialSiteDirectoryBot/0.2 (+https://github.com/bocmiao/official-site-directory)' },
      // Pin the validated DNS answer; a second resolution must not reach a private address.
      lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
    }, (response) => {
      resolve({ status: response.statusCode, location: response.headers.location });
      response.destroy(); // Inspect headers only; never download page bodies or binaries.
    });
    const timer = setTimeout(() => req.destroy(new Error('REQUEST_TIMEOUT')), 15000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}

export async function probeEntry(entry, allowedHosts, request = requestHeaders) {
  let current = parseWebUrl(entry.url);
  const chain = [];
  try {
    if (!current) throw new Error('UNSAFE_URL');
    for (let hop = 0; hop <= 3; hop++) {
      chain.push(current.href);
      const response = await request(current);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location) return { level: 'error', reason: 'MISSING_LOCATION', chain };
        const next = new URL(response.location, current);
        if (!parseWebUrl(next.href)) return { level: 'review', reason: 'UNSAFE_REDIRECT', final_url: next.href, chain };
        if (current.protocol === 'https:' && next.protocol !== 'https:') return { level: 'review', reason: 'HTTPS_DOWNGRADE', final_url: next.href, chain };
        if (!allowedHosts.includes(next.hostname)) return { level: 'review', reason: 'UNREGISTERED_HOST', final_url: next.href, chain };
        current = next;
        continue;
      }
      return { level: response.status >= 200 && response.status < 300 ? 'ok' : 'error', reason: `HTTP_${response.status}`, final_url: current.href, chain };
    }
    return { level: 'error', reason: 'TOO_MANY_REDIRECTS', final_url: current.href, chain };
  } catch (error) {
    const reason = error.code || error.message || 'NETWORK_ERROR';
    return { level: reason.startsWith('UNSAFE_') ? 'review' : 'error', reason, final_url: current?.href, chain };
  }
}

export function recordResult(result, previous, context) {
  const compatible = previous?.url === context.url && previous?.probe_region === context.probe_region;
  const failures = result.level === 'ok' ? 0 : (compatible ? previous.failures || 0 : 0) + 1;
  return { ...context, ...result, failures, actionable: result.level === 'review' || failures >= 2 };
}

export function reportSignature(results) {
  return JSON.stringify(results.filter((r) => r.actionable).map((r) => [r.key, r.reason, r.final_url || r.url]).sort((a, b) => a[0].localeCompare(b[0])));
}
