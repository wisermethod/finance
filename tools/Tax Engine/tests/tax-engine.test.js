import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { main } from '../scripts/tax-engine-core.js';

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(TOOL, 'scripts', 'tax-engine.js');
const STUB = join(TOOL, 'tests', 'support', 'stub-engine.js');
const ROOT_HASH = 'sha256:6c422520ead11760adc2090b94426f61030743205515627fbc749f14fb498c8a';
const BAD_ROOT = 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const BIG_CENTS = '9007199254740993';
const BIG_DOLLARS = '$90,071,992,547,409.93';
const BUNDLE_BYTES = Buffer.from('tax-engine-test-bundle\n');

const HELP_TOKENS = [
  'help',
  'compute',
  'check',
  '--facts',
  '--install',
  '--help',
  'liability',
  'estimate',
  'federal',
  '2025',
  '2026',
  'single',
  'mfj',
  'mfs',
  'hoh',
  'qss',
  'wages',
  'taxableInterest',
  'ordinaryDividends',
  'qualifiedDividends',
  'shortTermCapitalGains',
  'longTermCapitalGains',
  'federalTaxWithheld',
  'priorYearTax',
  'priorYearAGI',
  'priorYearReturnFiled',
  'priorYearTwelveMonths',
  'farmerOrFisherman',
  'Colorado',
  'us.federal.net_tax',
  'us.federal.estimated.quarterly_payment',
  'us.federal.estimated.annualized_installment_q1',
  'us.federal.estimated.annualized_installment_q2',
  'us.federal.estimated.annualized_installment_q3',
  'us.federal.estimated.annualized_installment_q4',
  'us.federal.estimated.safe_harbor_met'
];

function pinFor(bytes, over = {}) {
  return {
    packageName: '@invaro/opentax',
    packageVersion: '0.4.0',
    bundleSha256: createHash('sha256').update(bytes).digest('hex'),
    corpusName: '@invaro/opentax-corpus-us-federal',
    corpusVersion: '0.37.0',
    corpusMerkleRoot: ROOT_HASH,
    nodeRecorded: 'v25.1.0',
    ...over
  };
}

function liabilityFacts(over = {}) {
  return {
    operation: 'liability',
    jurisdiction: 'federal',
    taxYear: 2025,
    filingStatus: 'mfj',
    income: {
      wages: 150000,
      taxableInterest: 0,
      ordinaryDividends: 0,
      qualifiedDividends: 0,
      shortTermCapitalGains: 0,
      longTermCapitalGains: 0
    },
    ...over
  };
}

function estimateFacts(over = {}) {
  return {
    ...liabilityFacts(),
    operation: 'estimate',
    estimate: {
      federalTaxWithheld: 0,
      priorYearTax: 10000,
      priorYearAGI: 150000,
      priorYearReturnFiled: true,
      priorYearTwelveMonths: true,
      farmerOrFisherman: false
    },
    ...over
  };
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'tax-engine-'));
  const toolDir = join(root, 'tools', 'Tax Engine');
  mkdirSync(join(toolDir, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'tools', 'AGENTS.md'), '# Tools\n\nIndex.\n');
  const fromFile = join(toolDir, 'scripts', 'tax-engine.js');
  writeFileSync(fromFile, '// fromFile for consent walk\n');
  return {
    root,
    toolDir,
    fromFile,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function installTree(toolDir, { version = '0.4.0', bundle = BUNDLE_BYTES, extra } = {}) {
  const pkgDir = join(toolDir, 'node_modules', '@invaro', 'opentax');
  mkdirSync(join(pkgDir, 'bundle'), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), `${JSON.stringify({ name: '@invaro/opentax', version })}\n`);
  writeFileSync(join(pkgDir, 'bundle', 'index.js'), bundle);
  if (extra) extra(pkgDir);
  return pkgDir;
}

function writeFacts(dir, facts) {
  const file = join(dir, 'facts.json');
  writeFileSync(file, `${JSON.stringify(facts)}\n`);
  return file;
}

function placeStub(dir, config) {
  const enginePath = join(dir, 'stub-engine.js');
  copyFileSync(STUB, enginePath);
  writeFileSync(join(dir, 'stub-config.json'), JSON.stringify(config));
  return enginePath;
}

function okResult(pin, over = {}) {
  return {
    ok: true,
    target: 'us.federal.net_tax',
    asOf: '2025-12-31',
    answer: '$0.01 DECOY',
    valueCents: '100',
    meaning: 'net federal income tax',
    assumptions: [{
      factId: 'isSubjectToKiddieTax',
      value: { type: 'bool', value: false },
      source: 'default',
      rationale: 'Assumed not a kiddie-tax child absent contrary input'
    }],
    corpusMerkleRoot: pin.corpusMerkleRoot,
    artifactHash: 'sha256:abc123',
    ...over
  };
}

function received(enginePath) {
  const file = join(dirname(enginePath), 'received.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function run(box, args, extra = {}) {
  let called = false;
  const runInstall = extra.runInstall || (async () => {
    called = true;
    throw new Error('install should not run');
  });
  const result = await main(args, {
    toolDir: box.toolDir,
    fromFile: box.fromFile,
    pin: extra.pin || pinFor(BUNDLE_BYTES),
    runInstall,
    ...extra.options
  });
  return { result, installCalled: called || extra.installCalled };
}

function refusal(result, code) {
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, '');
  const body = JSON.parse(result.stderr);
  assert.equal(body.refused, true);
  assert.equal(body.code, code);
  assert.equal(typeof body.message, 'string');
  assert.match(body.message, /Fix:/);
  assert.equal(body.figure, undefined);
  assert.equal(body.valueCents, undefined);
  assert.equal(body.provenance.observed, undefined);
  assert.equal(body.provenance.corpusRoot, undefined);
  assert.equal(body.provenance.expected.packageName, '@invaro/opentax');
  assert.equal(body.provenance.expected.packageVersion, '0.4.0');
  assert.equal(body.provenance.expected.corpusName, '@invaro/opentax-corpus-us-federal');
  assert.equal(body.provenance.expected.corpusVersion, '0.37.0');
  assert.equal(body.provenance.expected.corpusRoot, ROOT_HASH);
  return body;
}

function subjects(body) {
  return Array.isArray(body.subject) ? body.subject : [body.subject];
}

function faultBody(result, code) {
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, '');
  const body = JSON.parse(result.stderr);
  assert.equal(body.refused, false);
  assert.equal(body.code, code);
  assert.equal(body.figure, undefined);
  assert.equal(body.valueCents, undefined);
  return body;
}

describe('tax engine', { concurrency: false }, () => {
  test('the shipped pin holds the measured engine', () => {
    const pin = JSON.parse(readFileSync(join(TOOL, 'pin.json'), 'utf8'));
    assert.deepEqual(pin, {
      packageName: '@invaro/opentax',
      packageVersion: '0.4.0',
      bundleSha256: '0975326041e325123a6b15015b0aadad3a8b9c3b884066130308a1616389de38',
      corpusName: '@invaro/opentax-corpus-us-federal',
      corpusVersion: '0.37.0',
      corpusMerkleRoot: ROOT_HASH,
      nodeRecorded: 'v25.1.0'
    });
  });

  test('importing the entry does not exit', async () => {
    const entry = await import(pathToFileURL(ENTRY).href);
    assert.equal(typeof entry.main, 'function');
  });

  test('help on a copy with nothing installed lists the vocabulary', () => {
    const box = sandbox();
    try {
      for (const name of ['tax-engine.js', 'tax-engine-core.js', 'consent.js']) {
        copyFileSync(join(TOOL, 'scripts', name), join(box.toolDir, 'scripts', name));
      }
      copyFileSync(join(TOOL, 'pin.json'), join(box.toolDir, 'pin.json'));
      copyFileSync(join(TOOL, 'package.json'), join(box.toolDir, 'package.json'));
      const script = join(box.toolDir, 'scripts', 'tax-engine.js');
      for (const args of [['help'], ['--help']]) {
        const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, '');
        for (const token of HELP_TOKENS) assert.ok(result.stdout.includes(token), token);
      }
      assert.equal(existsSync(join(box.toolDir, 'node_modules')), false);
      assert.equal(existsSync(join(box.root, '.wiser-consent')), false);
    } finally {
      box.cleanup();
    }
  });

  test('an unknown flag and an unknown command are refused by name', async () => {
    const box = sandbox();
    try {
      const marker = join(box.root, '.wiser-consent');
      const flag = await main(['compute', '--not-a-flag'], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin: pinFor(BUNDLE_BYTES)
      });
      assert.equal(flag.exitCode, 1);
      assert.equal(flag.stdout, '');
      assert.match(flag.stderr, /unknown option "--not-a-flag"/);
      assert.match(flag.stderr, /help/);
      const command = await main(['forecast'], { toolDir: box.toolDir, fromFile: box.fromFile });
      assert.equal(command.exitCode, 1);
      assert.match(command.stderr, /unknown command "forecast"/);
      assert.match(command.stderr, /help/);
      const missing = await main([], { toolDir: box.toolDir, fromFile: box.fromFile });
      assert.match(missing.stderr, /a command is required/);
      const hyphen = await main(['-h'], { toolDir: box.toolDir, fromFile: box.fromFile });
      assert.match(hyphen.stderr, /unknown option "-h"|a command is required/);
      assert.equal(existsSync(marker), false);
    } finally {
      box.cleanup();
    }
  });

  test('a relative or missing --facts path is refused by name before install', async () => {
    const box = sandbox();
    try {
      let called = false;
      const relative = await main(['compute', '--facts', 'facts.json'], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin: pinFor(BUNDLE_BYTES),
        runInstall: async () => { called = true; }
      });
      assert.equal(relative.exitCode, 1);
      assert.equal(relative.stdout, '');
      assert.match(relative.stderr, /facts\.json/);
      assert.match(relative.stderr, /absolute/);
      const missing = join(box.root, 'missing.json');
      const unread = await main(['compute', '--facts', missing], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin: pinFor(BUNDLE_BYTES),
        runInstall: async () => { called = true; }
      });
      assert.equal(unread.exitCode, 1);
      assert.match(unread.stderr, /missing\.json/);
      const disguised = await main(['compute', '--facts', '--install'], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin: pinFor(BUNDLE_BYTES),
        runInstall: async () => { called = true; }
      });
      assert.equal(disguised.exitCode, 1);
      assert.match(disguised.stderr, /absolute/);
      assert.equal(called, false);
      assert.equal(existsSync(join(box.root, '.wiser-consent')), false);
    } finally {
      box.cleanup();
    }
  });

  test('Colorado is refused by name, including case and surrounding space', async () => {
    const box = sandbox();
    try {
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pinFor(BUNDLE_BYTES)) });
      for (const jurisdiction of ['co', 'CO', 'colorado', ' Colorado ', 'CoLoRaDo']) {
        const facts = writeFacts(box.root, liabilityFacts({ jurisdiction }));
        const { result } = await run(box, ['compute', '--facts', facts], { options: { enginePath } });
        const body = refusal(result, 'COLORADO');
        assert.equal(body.subject, jurisdiction);
        assert.match(body.message, /Nothing this tool runs computes Colorado/);
      }
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('any other jurisdiction is refused as unsupported', async () => {
    const box = sandbox();
    try {
      const facts = writeFacts(box.root, liabilityFacts({ jurisdiction: 'ny' }));
      const { result } = await run(box, ['compute', '--facts', facts]);
      const body = refusal(result, 'JURISDICTION_UNSUPPORTED');
      assert.equal(body.subject, 'ny');
      assert.match(body.message, /ny/);
    } finally {
      box.cleanup();
    }
  });

  test('a needed fact that is absent is refused before the engine starts', async () => {
    const box = sandbox();
    try {
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pinFor(BUNDLE_BYTES)) });
      const one = liabilityFacts();
      delete one.income.wages;
      const facts = writeFacts(box.root, one);
      const { result } = await run(box, ['compute', '--facts', facts], { options: { enginePath } });
      const body = refusal(result, 'FACTS_MISSING');
      assert.deepEqual(subjects(body), ['income.wages']);
      const two = liabilityFacts();
      delete two.income.wages;
      delete two.income.taxableInterest;
      const more = writeFacts(box.root, two);
      const second = await run(box, ['compute', '--facts', more], { options: { enginePath } });
      const both = refusal(second.result, 'FACTS_MISSING');
      assert.deepEqual(subjects(both), ['income.wages', 'income.taxableInterest']);
      const estimate = estimateFacts();
      delete estimate.estimate;
      const estimateFile = writeFacts(box.root, estimate);
      const third = await run(box, ['compute', '--facts', estimateFile], { options: { enginePath } });
      const missingEstimate = refusal(third.result, 'FACTS_MISSING');
      assert.deepEqual(subjects(missingEstimate), [
        'estimate.federalTaxWithheld',
        'estimate.priorYearTax',
        'estimate.priorYearAGI',
        'estimate.priorYearReturnFiled',
        'estimate.priorYearTwelveMonths',
        'estimate.farmerOrFisherman'
      ]);
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('a value of the wrong type or outside its set is refused by key', async () => {
    const box = sandbox();
    try {
      const cases = [
        [liabilityFacts({ filingStatus: 'MFJ' }), 'filingStatus'],
        [liabilityFacts({ taxYear: '2025' }), 'taxYear'],
        [liabilityFacts({ taxYear: 2025.5 }), 'taxYear'],
        [liabilityFacts({ income: { ...liabilityFacts().income, wages: -1 } }), 'income.wages'],
        [liabilityFacts({ income: { ...liabilityFacts().income, wages: 1.005 } }), 'income.wages'],
        [estimateFacts({ estimate: { ...estimateFacts().estimate, farmerOrFisherman: 'yes' } }), 'estimate.farmerOrFisherman']
      ];
      for (const [facts, key] of cases) {
        const file = writeFacts(box.root, facts);
        const { result } = await run(box, ['compute', '--facts', file]);
        const body = refusal(result, 'INVALID_VALUE');
        assert.equal(body.subject, key);
      }
    } finally {
      box.cleanup();
    }
  });

  test('a year other than 2025 or 2026 is refused by name', async () => {
    const box = sandbox();
    try {
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pinFor(BUNDLE_BYTES)) });
      for (const taxYear of [2024, 2027, 2023]) {
        const facts = writeFacts(box.root, liabilityFacts({ taxYear }));
        const { result } = await run(box, ['compute', '--facts', facts], { options: { enginePath } });
        const body = refusal(result, 'YEAR_UNSUPPORTED');
        assert.equal(body.subject, taxYear);
        assert.match(body.message, new RegExp(String(taxYear)));
      }
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('an unsupported operation is refused by name, annualized targets included', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin, { valueCents: BIG_CENTS }) });
      const annualized = [
        'us.federal.estimated.annualized_installment_q1',
        'us.federal.estimated.annualized_installment_q2',
        'us.federal.estimated.annualized_installment_q3',
        'us.federal.estimated.annualized_installment_q4'
      ];
      for (const operation of annualized) {
        const facts = writeFacts(box.root, liabilityFacts({ operation }));
        const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
        const body = refusal(result, 'FEATURE_UNSUPPORTED');
        assert.equal(body.subject, operation);
        assert.match(body.message, /annualized installment method is not computed by this tool/);
        assert.equal(result.stderr.includes(BIG_CENTS), false);
      }
      for (const operation of ['us.federal.estimated.safe_harbor_met', 'us.federal.net_tax']) {
        const facts = writeFacts(box.root, liabilityFacts({ operation }));
        const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
        const body = refusal(result, 'FEATURE_UNSUPPORTED');
        assert.equal(body.subject, operation);
        assert.match(body.message, /not computed by this tool/);
      }
      const other = writeFacts(box.root, liabilityFacts({ operation: 'refund' }));
      const { result } = await run(box, ['compute', '--facts', other], { pin, options: { enginePath } });
      const body = refusal(result, 'FEATURE_UNSUPPORTED');
      assert.equal(body.subject, 'refund');
      assert.match(body.message, /liability/);
      assert.match(body.message, /estimate/);
      const farmer = writeFacts(box.root, estimateFacts({
        estimate: { ...estimateFacts().estimate, farmerOrFisherman: true }
      }));
      const farmerRun = await run(box, ['compute', '--facts', farmer], { pin, options: { enginePath } });
      const farmerBody = refusal(farmerRun.result, 'FEATURE_UNSUPPORTED');
      assert.equal(farmerBody.subject, 'estimate.farmerOrFisherman');
      assert.match(farmerBody.message, /farmer or fisherman/i);
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('prior-year eligibility flags that are false are refused by name', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin, { valueCents: BIG_CENTS }) });
      const base = estimateFacts().estimate;
      const cases = [
        [{ ...base, priorYearReturnFiled: false }, ['estimate.priorYearReturnFiled']],
        [{ ...base, priorYearTwelveMonths: false }, ['estimate.priorYearTwelveMonths']],
        [{
          ...base,
          priorYearReturnFiled: false,
          priorYearTwelveMonths: false
        }, ['estimate.priorYearReturnFiled', 'estimate.priorYearTwelveMonths']]
      ];
      for (const [estimate, names] of cases) {
        const facts = writeFacts(box.root, estimateFacts({ estimate }));
        const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
        const body = refusal(result, 'PRIOR_YEAR_INELIGIBLE');
        assert.deepEqual(subjects(body), names);
        for (const name of names) assert.ok(body.message.includes(name), name);
        assert.match(body.message, /6654\(d\)\(1\)\(B\)/);
      }
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('an unknown key is refused by its path before the engine starts', async () => {
    const box = sandbox();
    try {
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pinFor(BUNDLE_BYTES)) });
      const income = liabilityFacts();
      income.income.notARealFact = 1;
      const facts = writeFacts(box.root, income);
      const { result } = await run(box, ['compute', '--facts', facts], { options: { enginePath } });
      const body = refusal(result, 'UNKNOWN_KEY');
      assert.equal(body.subject, 'income.notARealFact');
      const liability = estimateFacts();
      const file = writeFacts(box.root, { ...liabilityFacts(), estimate: liability.estimate });
      const second = await run(box, ['compute', '--facts', file], { options: { enginePath } });
      const estimateKey = refusal(second.result, 'UNKNOWN_KEY');
      assert.equal(estimateKey.subject, 'estimate');
      assert.match(estimateKey.message, /estimate/);
      const raw = writeFacts(box.root, {});
      writeFileSync(raw, '{"income":{"wages":1,"wages":2}}\n');
      const third = await run(box, ['compute', '--facts', raw], { options: { enginePath } });
      const duplicate = refusal(third.result, 'DUPLICATE_KEY');
      assert.equal(duplicate.subject, 'income.wages');
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('a bundle mismatch and a version mismatch are refused before the engine starts', async () => {
    const box = sandbox();
    try {
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin, { valueCents: BIG_CENTS }) });
      const facts = writeFacts(box.root, liabilityFacts());
      installTree(box.toolDir, { version: '0.9.9', bundle: BUNDLE_BYTES });
      const version = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      const versionBody = refusal(version.result, 'PIN_VERSION');
      assert.equal(versionBody.subject, 'packageVersion');
      assert.match(versionBody.message, /0\.9\.9/);
      assert.equal(version.result.stderr.includes(BIG_CENTS), false);
      rmSync(join(box.toolDir, 'node_modules'), { recursive: true, force: true });
      installTree(box.toolDir, { version: '0.4.0', bundle: Buffer.from('other-bytes') });
      const bundle = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      const bundleBody = refusal(bundle.result, 'PIN_BUNDLE');
      assert.equal(bundleBody.subject, 'bundle/index.js');
      assert.equal(bundle.result.stderr.includes(BIG_CENTS), false);
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('a missing bundle is incomplete and main.js is not started', async () => {
    const box = sandbox();
    try {
      const pkgDir = installTree(box.toolDir, { version: '0.4.0', bundle: BUNDLE_BYTES });
      rmSync(join(pkgDir, 'bundle', 'index.js'));
      const writer = "import { writeFileSync } from 'node:fs';\nimport { dirname, join } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nwriteFileSync(join(dirname(fileURLToPath(import.meta.url)), 'started.txt'), 'yes\\n');\n";
      writeFileSync(join(pkgDir, 'bundle', 'main.js'), writer);
      writeFileSync(join(pkgDir, 'bundle', 'http.js'), writer);
      const facts = writeFacts(box.root, liabilityFacts());
      const { result } = await run(box, ['compute', '--facts', facts], { pin: pinFor(BUNDLE_BYTES) });
      faultBody(result, 'ENGINE_INCOMPLETE');
      assert.equal(existsSync(join(pkgDir, 'bundle', 'started.txt')), false);
      assert.equal(existsSync(join(pkgDir, 'started.txt')), false);
    } finally {
      box.cleanup();
    }
  });

  test('the engine NEEDS_FACTS answer is a refusal and carries no figure', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'needs-facts' });
      const facts = writeFacts(box.root, liabilityFacts());
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      const body = refusal(result, 'NEEDS_FACTS');
      assert.equal(body.subject, 'filingStatus');
      assert.equal(result.stderr.includes('1589800'), false);
    } finally {
      box.cleanup();
    }
  });

  test('the engine NO_APPLICABLE_RULE answer is a refusal', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'no-rule' });
      const facts = writeFacts(box.root, liabilityFacts());
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      const body = refusal(result, 'NO_APPLICABLE_RULE');
      assert.equal(body.subject, '2023-12-31');
      assert.match(body.message, /2023-12-31/);
    } finally {
      box.cleanup();
    }
  });

  test('an engine schema rejection is a refusal naming the key', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const facts = writeFacts(box.root, liabilityFacts());
      for (const mode of ['schema-text', 'schema-rpc']) {
        const enginePath = placeStub(box.root, { mode });
        const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
        const body = refusal(result, 'SCHEMA_REJECTED');
        assert.equal(body.subject, 'income.notARealFact');
        rmSync(join(dirname(enginePath), 'received.json'), { force: true });
      }
    } finally {
      box.cleanup();
    }
  });

  test('a defaulted needed fact after the engine answers is refused with no figure', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const assumptions = [
        {
          factId: 'wages',
          value: { type: 'money', value: '0' },
          source: 'default',
          rationale: 'Assumed no wages absent contrary input'
        },
        {
          factId: 'isSubjectToKiddieTax',
          value: { type: 'bool', value: false },
          source: 'default',
          rationale: 'Assumed not a kiddie-tax child absent contrary input'
        }
      ];
      const enginePath = placeStub(box.root, {
        mode: 'ok',
        result: okResult(pin, { valueCents: BIG_CENTS, assumptions })
      });
      const facts = writeFacts(box.root, liabilityFacts());
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      const body = refusal(result, 'FACTS_DEFAULTED');
      assert.equal(body.subject, 'wages');
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.includes(BIG_CENTS), false);
      assert.equal(result.stderr.includes('90,071,992,547,409.93'), false);
      const estimateAssumptions = [{
        factId: 'isFarmerOrFisherman',
        value: { type: 'bool', value: false },
        source: 'default',
        rationale: 'Assumed not a qualifying farmer/fisherman absent contrary input'
      }, {
        factId: 'federalTaxWithheld',
        value: { type: 'money', value: '0' },
        source: 'default',
        rationale: 'Assumed no withholding reported absent contrary input'
      }];
      const estimateEngine = placeStub(box.root, {
        mode: 'ok',
        result: okResult(pin, { valueCents: BIG_CENTS, assumptions: estimateAssumptions })
      });
      const estimate = writeFacts(box.root, estimateFacts());
      const second = await run(box, ['compute', '--facts', estimate], { pin, options: { enginePath: estimateEngine } });
      const estimateBody = refusal(second.result, 'FACTS_DEFAULTED');
      assert.ok(subjects(estimateBody).includes('isFarmerOrFisherman'));
      assert.ok(subjects(estimateBody).includes('federalTaxWithheld'));
      assert.equal(second.result.stderr.includes(BIG_CENTS), false);
    } finally {
      box.cleanup();
    }
  });

  test('a corpus root mismatch is refused with no figure', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, {
        mode: 'ok',
        result: okResult(pin, { valueCents: BIG_CENTS, corpusMerkleRoot: BAD_ROOT, answer: '$0.01 DECOY' })
      });
      const facts = writeFacts(box.root, liabilityFacts());
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      const body = refusal(result, 'PIN_ROOT');
      assert.equal(body.subject, 'corpusMerkleRoot');
      assert.equal(result.stderr.includes(BIG_CENTS), false);
      assert.equal(result.stderr.includes('DECOY'), false);
      assert.equal(result.stderr.includes('deadbeef'), false);
      assert.equal(body.provenance.expected.corpusRoot, ROOT_HASH);
    } finally {
      box.cleanup();
    }
  });

  test('success keeps the operation label, the exact cents, and the pin versions', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES, { nodeRecorded: 'v0.0.0-recorded' });
      const assumptions = [
        {
          factId: 'isSubjectToKiddieTax',
          value: { type: 'bool', value: false },
          source: 'default',
          rationale: 'Assumed not a kiddie-tax child absent contrary input'
        },
        {
          factId: 'federalTaxWithheld',
          value: { type: 'money', value: '0' },
          source: 'default',
          rationale: 'Assumed no withholding reported absent contrary input'
        },
        {
          factId: 'wages',
          value: { type: 'money', value: '150000' },
          source: 'input',
          rationale: 'stated'
        }
      ];
      const enginePath = placeStub(box.root, {
        mode: 'ok',
        result: okResult(pin, { valueCents: BIG_CENTS, assumptions, meaning: 'net federal income tax' })
      });
      const facts = writeFacts(box.root, liabilityFacts({ income: {
        wages: 0,
        taxableInterest: 0,
        ordinaryDividends: 0,
        qualifiedDividends: 0,
        shortTermCapitalGains: 0,
        longTermCapitalGains: 0
      } }));
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, '');
      const body = JSON.parse(result.stdout);
      assert.equal(body.operation, 'liability');
      assert.equal(body.jurisdiction, 'federal');
      assert.equal(body.taxYear, 2025);
      assert.equal(body.filingStatus, 'mfj');
      assert.equal(body.figure.valueCents, BIG_CENTS);
      assert.equal(body.figure.dollars, BIG_DOLLARS);
      assert.equal(body.figure.label, 'Federal individual net income tax');
      assert.equal(result.stdout.includes('net federal income tax'), false);
      assert.equal(result.stdout.includes('0.1.0'), false);
      assert.equal(result.stdout.includes('DECOY'), false);
      assert.deepEqual(body.assumptions, [
        {
          fact: 'isSubjectToKiddieTax',
          value: { type: 'bool', value: false },
          rationale: 'Assumed not a kiddie-tax child absent contrary input'
        },
        {
          fact: 'federalTaxWithheld',
          value: { type: 'money', value: '0' },
          rationale: 'Assumed no withholding reported absent contrary input'
        }
      ]);
      assert.equal(body.provenance.packageVersion, '0.4.0');
      assert.equal(body.provenance.corpusVersion, '0.37.0');
      assert.equal(body.provenance.corpusRoot, ROOT_HASH);
      assert.equal(body.provenance.artifactHash, 'sha256:abc123');
      assert.equal(body.provenance.bundleHash, pin.bundleSha256);
      assert.equal(body.provenance.node, process.version);
      assert.equal(body.provenance.nodeRecorded, 'v0.0.0-recorded');
      assert.match(body.statement, /computation, not tax advice/);
      assert.match(body.statement, /licensed CPA, enrolled agent, or other tax professional/);
      const report = received(enginePath);
      assert.deepEqual(report.methods, ['initialize', 'notifications/initialized', 'tools/call']);
      assert.equal(report.call.params.arguments.target, 'us.federal.net_tax');
      assert.equal(report.call.params.arguments.asOf, '2025-12-31');
      assert.equal(report.call.params.arguments.income.wages, 0);
      assert.equal(report.call.params.arguments.payments_estimates, undefined);
      assert.deepEqual(report.execArgv, []);
      assert.equal(report.argv.length, 1);
    } finally {
      box.cleanup();
    }
  });

  test('an estimate is labelled from the operation and describes the regular method', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, {
        mode: 'ok',
        result: okResult(pin, {
          valueCents: '250000',
          meaning: 'net federal income tax',
          target: 'us.federal.estimated.quarterly_payment'
        })
      });
      const facts = writeFacts(box.root, estimateFacts({ taxYear: 2026 }));
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      assert.equal(result.exitCode, 0, result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.operation, 'estimate');
      assert.equal(body.taxYear, 2026);
      assert.equal(body.figure.valueCents, '250000');
      assert.equal(body.figure.dollars, '$2,500.00');
      assert.equal(body.figure.label, 'Required quarterly estimated payment by the regular installment method');
      assert.equal(result.stdout.includes('net federal income tax'), false);
      assert.equal(body.estimateDetail.fourRequiredInstallments, true);
      assert.equal(body.estimateDetail.regularInstallmentMethod, true);
      assert.equal(body.estimateDetail.withholdingTreatedAsPaidEvenly, true);
      assert.equal(body.estimateDetail.annualizedInstallmentMethodComputed, false);
      assert.match(body.estimateDetail.statement, /four required installments/);
      assert.match(body.estimateDetail.statement, /paid evenly/);
      assert.match(body.estimateDetail.statement, /annualized installment method was not computed/);
      const call = received(enginePath).call.params.arguments;
      assert.equal(call.target, 'us.federal.estimated.quarterly_payment');
      assert.equal(call.asOf, '2026-12-31');
      assert.equal(call.payments_estimates.isFarmerOrFisherman, false);
      assert.equal(call.payments_estimates.federalTaxWithheld, 0);
      assert.equal(call.payments_estimates.priorYearTax, 10000);
      assert.equal(call.payments_estimates.priorYearAGI, 150000);
      assert.equal(JSON.stringify(call).includes('priorYearReturnFiled'), false);
      assert.equal(JSON.stringify(call).includes('priorYearTwelveMonths'), false);
    } finally {
      box.cleanup();
    }
  });

  test('the child receives the opt-out variables and not NODE_OPTIONS', async () => {
    const box = sandbox();
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = '--require /tmp/tax-engine-preload.js';
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin) });
      const facts = writeFacts(box.root, liabilityFacts());
      const result = await main(['compute', '--facts', facts], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin,
        enginePath,
        env: {
          NODE_OPTIONS: '--require /tmp/tax-engine-preload.js',
          PATH: '/usr/bin',
          HOME: '/tmp',
          WISER_ALLOW_INSTALL: '1'
        }
      });
      assert.equal(result.exitCode, 0, result.stderr);
      const env = received(enginePath).env;
      assert.equal(env.OPENTAX_TELEMETRY, '0');
      assert.equal(env.DO_NOT_TRACK, '1');
      assert.equal(env.NODE_OPTIONS, undefined);
      assert.equal(env.PATH, undefined);
      assert.equal(env.HOME, undefined);
      assert.equal(env.WISER_ALLOW_INSTALL, undefined);
      for (const key of Object.keys(env)) {
        assert.ok(
          key === 'OPENTAX_TELEMETRY' || key === 'DO_NOT_TRACK' || key === '__CF_USER_TEXT_ENCODING',
          key
        );
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
      box.cleanup();
    }
  });

  test('a timeout, a crash, and an unreadable answer are faults', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const facts = writeFacts(box.root, liabilityFacts());
      const hang = placeStub(box.root, { mode: 'hang' });
      const timed = await run(box, ['compute', '--facts', facts], {
        pin,
        options: { enginePath: hang, timeoutMs: 400 }
      });
      faultBody(timed.result, 'ENGINE_TIMEOUT');
      assert.ok(received(hang));
      const crash = placeStub(box.root, { mode: 'crash' });
      const crashed = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath: crash } });
      faultBody(crashed.result, 'ENGINE_CRASH');
      const garbage = placeStub(box.root, { mode: 'garbage' });
      const unread = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath: garbage } });
      faultBody(unread.result, 'ENGINE_UNREADABLE');
    } finally {
      box.cleanup();
    }
  });

  test('a symlink facts path is read through its real path', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin) });
      const real = writeFacts(box.root, liabilityFacts({ filingStatus: 'single' }));
      const link = join(box.root, 'linked.json');
      symlinkSync(real, link);
      const { result } = await run(box, ['compute', '--facts', link], { pin, options: { enginePath } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).filingStatus, 'single');
      assert.equal(received(enginePath).call.params.arguments.filing.filingStatus, 'single');
    } finally {
      box.cleanup();
    }
  });

  test('check reports absent, incomplete, and complete and does not start the engine', async () => {
    const box = sandbox();
    try {
      const pin = pinFor(BUNDLE_BYTES);
      const absent = await main(['check'], { toolDir: box.toolDir, fromFile: box.fromFile, pin });
      assert.equal(absent.exitCode, 0, absent.stderr);
      const absentBody = JSON.parse(absent.stdout);
      assert.equal(absentBody.engine, 'absent');
      assert.equal(absentBody.bundleMatchesPin, null);
      assert.equal(absentBody.packageVersionMatchesPin, null);
      assert.equal(absentBody.pin.packageVersion, '0.4.0');
      assert.equal(absentBody.pin.corpusVersion, '0.37.0');
      assert.equal(absentBody.pin.corpusMerkleRoot, ROOT_HASH);
      assert.equal(absentBody.pin.nodeRecorded, 'v25.1.0');
      installTree(box.toolDir, { version: '0.4.0', bundle: BUNDLE_BYTES, extra(pkgDir) {
        rmSync(join(pkgDir, 'bundle', 'index.js'));
      } });
      const incomplete = await main(['check'], { toolDir: box.toolDir, fromFile: box.fromFile, pin });
      const incompleteBody = JSON.parse(incomplete.stdout);
      assert.equal(incompleteBody.engine, 'incomplete');
      assert.equal(incompleteBody.bundleMatchesPin, null);
      assert.equal(incompleteBody.packageVersionMatchesPin, true);
      rmSync(join(box.toolDir, 'node_modules'), { recursive: true, force: true });
      const writer = "import { writeFileSync } from 'node:fs';\nimport { dirname, join } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nwriteFileSync(join(dirname(fileURLToPath(import.meta.url)), 'started.txt'), 'yes\\n');\n";
      installTree(box.toolDir, { version: '0.4.0', bundle: writer });
      const completePin = pinFor(Buffer.from(writer));
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(completePin) });
      const complete = await main(['check'], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin: completePin,
        enginePath
      });
      const completeBody = JSON.parse(complete.stdout);
      assert.equal(completeBody.engine, 'complete');
      assert.equal(completeBody.bundleMatchesPin, true);
      assert.equal(completeBody.packageVersionMatchesPin, true);
      assert.equal(existsSync(join(box.toolDir, 'node_modules', '@invaro', 'opentax', 'bundle', 'started.txt')), false);
      assert.equal(received(enginePath), null);
      rmSync(join(box.toolDir, 'node_modules'), { recursive: true, force: true });
      installTree(box.toolDir, { version: '0.9.9', bundle: BUNDLE_BYTES });
      const version = JSON.parse((await main(['check'], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin
      })).stdout);
      assert.equal(version.engine, 'incomplete');
      assert.equal(version.packageVersionMatchesPin, false);
      assert.equal(version.bundleMatchesPin, true);
    } finally {
      box.cleanup();
    }
  });

  test('a missing dependency names the package, the host, the directory, and the size', async () => {
    const box = sandbox();
    try {
      const facts = writeFacts(box.root, liabilityFacts());
      let called = false;
      const result = await main(['compute', '--facts', facts], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin: pinFor(BUNDLE_BYTES),
        runInstall: async () => { called = true; }
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /@invaro\/opentax@0\.4\.0/);
      assert.match(result.stderr, /registry\.npmjs\.org/);
      assert.ok(result.stderr.includes(box.toolDir));
      assert.match(result.stderr, /5131493/);
      assert.match(result.stderr, /--install/);
      assert.equal(called, false);
      assert.equal(existsSync(join(box.root, '.wiser-consent')), false);
    } finally {
      box.cleanup();
    }
  });

  test('a matching consent marker authorises compute and is not rewritten', async () => {
    const box = sandbox();
    try {
      const root = realpathSync(box.root);
      writeFileSync(join(root, '.wiser-consent'), `${JSON.stringify({
        realpath: root,
        date: '1999-01-01',
        tool: 'earlier'
      })}\n`);
      chmodSync(join(root, '.wiser-consent'), 0o600);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin) });
      const facts = writeFacts(box.root, liabilityFacts());
      let called = false;
      const result = await main(['compute', '--facts', facts], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin,
        enginePath,
        env: {},
        runInstall: async (dir) => {
          called = true;
          installTree(dir);
        }
      });
      assert.equal(called, true);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stderr, /First run: installing dependencies/);
      assert.equal(JSON.parse(result.stdout).figure.valueCents, '100');
      const marker = JSON.parse(readFileSync(join(root, '.wiser-consent'), 'utf8'));
      assert.equal(marker.date, '1999-01-01');
      assert.equal(marker.tool, 'earlier');
    } finally {
      box.cleanup();
    }
  });

  test('a mismatched consent marker does not authorise an install', async () => {
    const box = sandbox();
    try {
      const root = realpathSync(box.root);
      const body = `${JSON.stringify({ realpath: '/tmp/some-other-copy', date: '1999-01-01', tool: 'earlier' })}\n`;
      writeFileSync(join(root, '.wiser-consent'), body);
      const facts = writeFacts(box.root, liabilityFacts());
      let called = false;
      const result = await main(['compute', '--facts', facts], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin: pinFor(BUNDLE_BYTES),
        env: {},
        runInstall: async () => { called = true; }
      });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /registry\.npmjs\.org/);
      assert.equal(called, false);
      assert.equal(readFileSync(join(root, '.wiser-consent'), 'utf8'), body);
    } finally {
      box.cleanup();
    }
  });

  test('check without --install does not install and does not write the marker', async () => {
    const box = sandbox();
    try {
      let called = false;
      const result = await main(['check'], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin: pinFor(BUNDLE_BYTES),
        env: { WISER_ALLOW_INSTALL: '1', NODE_OPTIONS: '--require /tmp/tax-engine-preload.js' },
        runInstall: async () => { called = true; }
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).engine, 'absent');
      assert.equal(called, false);
      assert.equal(existsSync(join(box.root, '.wiser-consent')), false);
      assert.equal(result.stderr, '');
    } finally {
      box.cleanup();
    }
  });

  test('check --install installs, writes the marker, and then reports', async () => {
    const box = sandbox();
    try {
      const pin = pinFor(BUNDLE_BYTES);
      let called = false;
      const result = await main(['check', '--install'], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin,
        env: {},
        runInstall: async (dir) => {
          called = true;
          installTree(dir);
        }
      });
      assert.equal(called, true);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stderr, /First run: installing dependencies/);
      const body = JSON.parse(result.stdout);
      assert.equal(body.engine, 'complete');
      assert.equal(body.bundleMatchesPin, true);
      const markerPath = join(realpathSync(box.root), '.wiser-consent');
      const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
      assert.equal(marker.realpath, realpathSync(box.root));
      assert.equal(marker.tool, 'Tax Engine');
      assert.match(marker.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(statSync(markerPath).mode & 0o777, 0o600);
    } finally {
      box.cleanup();
    }
  });

  test('WISER_ALLOW_INSTALL authorises compute and Node older than 20 is refused', async () => {
    const box = sandbox();
    try {
      const pin = pinFor(BUNDLE_BYTES);
      const facts = writeFacts(box.root, liabilityFacts());
      let called = false;
      const old = await main(['compute', '--install', '--facts', facts], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin,
        nodeVersion: 'v18.19.0',
        runInstall: async () => { called = true; }
      });
      assert.equal(old.exitCode, 1);
      assert.match(old.stderr, /Node v18\.19\.0/);
      assert.match(old.stderr, /Node 20/);
      assert.equal(called, false);
      assert.equal(existsSync(join(box.root, '.wiser-consent')), false);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin) });
      const allowed = await main(['compute', '--facts', facts], {
        toolDir: box.toolDir,
        fromFile: box.fromFile,
        pin,
        enginePath,
        env: { WISER_ALLOW_INSTALL: '1' },
        runInstall: async (dir) => { installTree(dir); }
      });
      assert.equal(allowed.exitCode, 0, allowed.stderr);
      const marker = JSON.parse(readFileSync(join(realpathSync(box.root), '.wiser-consent'), 'utf8'));
      assert.equal(marker.tool, 'Tax Engine');
      assert.equal(marker.realpath, realpathSync(box.root));
    } finally {
      box.cleanup();
    }
  });

  test('the shipped entry refuses an unknown flag without writing a marker', () => {
    const marker = join(TOOL, '..', '..', '.wiser-consent');
    const before = existsSync(marker) ? statSync(marker).mtimeMs : null;
    const modules = existsSync(join(TOOL, 'node_modules'));
    const result = spawnSync(process.execPath, [ENTRY, '--not-a-real-flag'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--not-a-real-flag/);
    assert.match(result.stderr, /help/);
    const after = existsSync(marker) ? statSync(marker).mtimeMs : null;
    assert.equal(after, before);
    assert.equal(existsSync(join(TOOL, 'node_modules')), modules);
  });
});
