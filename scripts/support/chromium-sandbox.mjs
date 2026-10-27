/** Linux Chromium admission for a caller-owned, isolated CDP preflight page. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const moduleSha256 = sha256(readFileSync(new URL(import.meta.url)));
const MAX_STATUS_BYTES = 65536;
const ROWS = Object.freeze({
  layer1: 'Layer 1 Sandbox',
  pid: 'PID namespaces',
  network: 'Network namespaces',
  seccomp: 'Seccomp-BPF sandbox',
  tsync: 'Seccomp-BPF sandbox supports TSYNC',
});

/** Parse observed text only. A parsed string alone is not browser admission. */
export function parseChromiumSandbox(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_STATUS_BYTES) {
    throw new TypeError('Sandbox status must be at most 65536 UTF-8 bytes.');
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
  const rows = {}, duplicates = [];
  for (const [key, label] of Object.entries(ROWS)) {
    const values = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line === label) {
        const next = lines[index + 1] || '';
        const anotherLabel = Object.values(ROWS).some(other => next === other || next.startsWith(other + '\t') || next.startsWith(other + ' '));
        values.push(anotherLabel || next.startsWith('You are ') ? '' : next);
      }
      else if (line.startsWith(label) && /^[\t ]/.test(line.slice(label.length))) {
        // The longer TSYNC row is not the shorter Seccomp row.
        if (key === 'seccomp' && line.startsWith(ROWS.tsync)) continue;
        values.push(line.slice(label.length).trim());
      }
    }
    rows[key] = values.length === 1 ? values[0] : null;
    if (values.length > 1) duplicates.push(key);
  }
  const checks = {
    adequate: lines.includes('You are adequately sandboxed.'),
    layer1: ['Namespace', 'SUID'].includes(rows.layer1),
    pid: rows.pid === 'Yes', network: rows.network === 'Yes',
    seccomp: rows.seccomp === 'Yes', tsync: rows.tsync === 'Yes',
  };
  const populated = Object.values(rows).every(value => typeof value === 'string' && value.length > 0);
  return {rows, checks, populated, duplicates, active: populated && !duplicates.length && Object.values(checks).every(Boolean)};
}

export class ChromiumSandboxError extends Error {
  constructor(message, receipt) {
    super(message);
    this.name = 'ChromiumSandboxError';
    this.receipt = receipt;
  }
}

/**
 * Navigate ONLY the explicitly supplied isolated page. `send` is that page's
 * existing CDP request function. No discovery, process launch, installation,
 * port allocation, product navigation or cleanup is performed here.
 * Throws ChromiumSandboxError carrying the partial receipt on any refusal.
 */
export async function requireChromiumSandbox({send, timeoutMs = 8000, pollIntervalMs = 50, signal} = {}) {
  if (typeof send !== 'function') throw new TypeError('An owned CDP send function is required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new RangeError('timeoutMs must be 1–60000.');
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 1000) throw new RangeError('pollIntervalMs must be 1–1000.');
  const startedAt = new Date().toISOString(), started = performance.now();
  const receipt = {
    schema: 'hamon-chromium-sandbox/v1', qualification: 'Linux Chromium status in the supplied isolated CDP page',
    moduleSha256, startedAt, completedAt: null, durationMs: null, admitted: false,
    browser: null, target: null, url: null, text: '', textSha256: sha256(''), observation: parseChromiumSandbox(''),
    failure: null,
  };
  let timer, onAbort, stoppedError = null;
  const stop = new Promise((_, reject) => {
    const stopWith = error => { stoppedError = error; reject(error); };
    timer = setTimeout(() => stopWith(Object.assign(Error('Sandbox admission timed out.'), {code: 'timeout'})), timeoutMs);
    onAbort = () => stopWith(Object.assign(Error('Sandbox admission was cancelled.'), {code: 'cancelled'}));
    signal?.addEventListener('abort', onAbort, {once: true});
  });
  // Race every await against the same deadline; a hung CDP call must not extend
  // the admission bound. Its late result cannot admit a retired course.
  const step = operation => Promise.race([stop, Promise.resolve().then(() => {
    if (stoppedError) throw stoppedError;
    return operation();
  })]);
  try {
    if (signal?.aborted) throw Object.assign(Error('Sandbox admission was cancelled.'), {code: 'cancelled'});
    receipt.browser = await step(() => send('Browser.getVersion'));
    receipt.target = (await step(() => send('Target.getTargetInfo'))).targetInfo;
    if (receipt.target?.type !== 'page' || !receipt.target.targetId) {
      throw Object.assign(Error('The supplied CDP target is not an identified page.'), {code: 'wrong_target'});
    }
    await step(() => send('Page.enable'));
    await step(() => send('Runtime.enable'));
    const navigation = await step(() => send('Page.navigate', {url: 'chrome://sandbox'}));
    if (navigation?.errorText) throw Object.assign(Error(navigation.errorText), {code: 'navigation_failed'});
    while (true) {
      const response = await step(() => send('Runtime.evaluate', {
        expression: '({url:location.href,text:document.body?.innerText||""})', returnByValue: true,
      }));
      if (response.exceptionDetails) throw Object.assign(Error('Could not read the sandbox status page.'), {code: 'evaluation_failed'});
      const value = response.result?.value;
      if (value && typeof value.url === 'string') receipt.url = value.url;
      // Never accept an ordinary page containing a copied status string.
      if (receipt.url === 'chrome://sandbox/' || receipt.url === 'chrome://sandbox') {
        if (typeof value?.text !== 'string') throw Object.assign(Error('Sandbox page returned no text.'), {code: 'invalid_status'});
        receipt.observation = parseChromiumSandbox(value.text);
        receipt.text = value.text;
        receipt.textSha256 = sha256(value.text);
        if (receipt.observation.duplicates.length) throw Object.assign(Error('Sandbox status has duplicate required rows.'), {code: 'ambiguous_status'});
        // chrome://sandbox populates asynchronously. A heading, or any one row,
        // is not enough. Wait for every required row before the strict gate.
        if (receipt.observation.populated) {
          const {adequate, ...protections} = receipt.observation.checks;
          if (!Object.values(protections).every(Boolean)) throw Object.assign(Error('Chromium did not report every required sandbox protection active.'), {code: 'inactive_sandbox'});
          // The summary can be populated after the table. Never admit without
          // it, but let the one deadline bound that asynchronous completion.
          if (adequate) {
            receipt.admitted = true;
            return receipt;
          }
        }
      }
      let pause;
      try { await step(() => new Promise(resolve => { pause = setTimeout(resolve, pollIntervalMs); })); }
      finally { clearTimeout(pause); }
    }
  } catch (error) {
    receipt.failure = {code: error?.code || 'protocol_failed', message: String(error?.message || error)};
    throw new ChromiumSandboxError(receipt.failure.message, receipt);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    receipt.completedAt = new Date().toISOString();
    receipt.durationMs = performance.now() - started;
  }
}
