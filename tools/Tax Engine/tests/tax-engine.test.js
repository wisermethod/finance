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
  'medicareWages',
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
  'priorYearAdjusted',
  'farmerOrFisherman',
  'spouseItemizes',
  'profile',
  'otherIncome',
  'adjustmentsOrItemizing',
  'credits',
  'dependents',
  'ageOrBlindness',
  'claimableAsDependent',
  'otherTaxes',
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

function supportedProfile(over = {}) {
  return {
    otherIncome: false,
    adjustmentsOrItemizing: false,
    credits: false,
    dependents: false,
    ageOrBlindness: false,
    claimableAsDependent: false,
    otherTaxes: false,
    ...over
  };
}

function liabilityFacts(over = {}) {
  return {
    operation: 'liability',
    jurisdiction: 'federal',
    taxYear: 2025,
    filingStatus: 'mfj',
    profile: supportedProfile(),
    income: {
      wages: 150000,
      medicareWages: 150000,
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
      priorYearAdjusted: false,
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
        'estimate.priorYearAdjusted',
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

  test('a negative figure from the engine is refused with no figure', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, {
        mode: 'ok',
        result: okResult(pin, { valueCents: '-4567800', answer: '-$45,678.00' })
      });
      const facts = writeFacts(box.root, liabilityFacts());
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      const body = refusal(result, 'NEGATIVE_FIGURE');
      assert.equal(body.subject, 'valueCents');
      assert.equal(result.stderr.includes('4567800'), false);
      assert.equal(result.stderr.includes('45,678'), false);
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
        medicareWages: 0,
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
      assert.equal(body.figure.label, 'Federal total tax, Form 1040 line 24, less refundable credits');
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
      assert.equal(report.call.params.arguments.income.wages, '0.00');
      assert.equal(report.call.params.arguments.income.medicareWages, '0.00');
      assert.equal(report.call.params.arguments.profile, undefined);
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
      const calls = received(enginePath).calls.map((entry) => entry.params.arguments);
      const call = calls.find((item) => item.target === 'us.federal.estimated.quarterly_payment');
      assert.ok(call);
      assert.ok(calls.some((item) => item.target === 'us.federal.balance_due'));
      assert.ok(calls.some((item) => item.target === 'us.federal.estimated.required_annual_payment'));
      assert.equal(calls.some((item) => item.target === 'us.federal.estimated.safe_harbor_met'), false);
      assert.equal(call.asOf, '2026-12-31');
      assert.equal(call.payments_estimates.isFarmerOrFisherman, false);
      assert.equal(call.payments_estimates.federalTaxWithheld, '0.00');
      assert.equal(call.payments_estimates.priorYearTax, '10000.00');
      assert.equal(call.payments_estimates.priorYearAGI, '150000.00');
      assert.equal(call.profile, undefined);
      assert.equal(body.estimateDetail.determination, false);
      assert.equal(body.estimateDetail.regularMethodInstallment.valueCents, '250000');
      assert.equal(JSON.stringify(call).includes('priorYearReturnFiled'), false);
      assert.equal(JSON.stringify(call).includes('priorYearTwelveMonths'), false);
      assert.equal(JSON.stringify(call).includes('priorYearAdjusted'), false);
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

  function centsOf(value) {
    const text = Object.is(value, -0) ? '0' : String(value);
    const dot = text.indexOf('.');
    const whole = dot === -1 ? text : text.slice(0, dot);
    const frac = dot === -1 ? '' : text.slice(dot + 1);
    return BigInt(whole) * 100n + BigInt(`${frac}00`.slice(0, 2));
  }

  test('help defines each fact, including the lines a document uses', async () => {
    const result = await main(['help']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    const text = result.stdout;
    const phrases = [
      "The year's wages, Form W-2 box 1, summed over every W-2.",
      "The year's taxable interest, Form 1099-INT box 1 plus box 3.",
      'Form 1099-DIV box 1a, qualified dividends included',
      'Form 1099-DIV box 1b',
      'The net short-term capital gain after netting, zero where the net is a loss.',
      'The net long-term capital gain after netting, zero where the net is a loss.',
      'A net capital loss is outside what this tool computes.',
      'already withheld plus still to be withheld, Form W-2 box 2,',
      'plus any Additional Medicare Tax withheld (Form W-2 box 6 above 1.45% of box 5), summed over every W-2.',
      "The year's Medicare wages and tips, Form W-2 box 5, summed over every W-2.",
      'the federal total tax, Form 1040 line 24, less refundable credits',
      'box 4 of every Form 1099-INT and 1099-DIV',
      'no required quarterly estimated payment under 26 U.S.C. § 6654(e)',
      'Estimated payments are excluded',
      '26 U.S.C. § 6654(g)',
      "The engine's own description also folds in estimated payments. This tool's definition does not.",
      "The total tax shown on the preceding year's return, Form 1040 line 24, as amended if it was.",
      'With priorYearAdjusted false, that amount is the one 26 U.S.C. § 6654(d)(1)(B) uses.',
      "The adjusted gross income shown on the preceding year's return.",
      'the earned income credit, the additional child tax credit, the refundable part of the American opportunity credit or a net premium tax credit',
      'filed a joint return in one of the two years and a separate return in the other',
      'The engine reads a zero box 5 as absent and substitutes box 1, so wages exempt from Medicare tax are outside this tool.',
      'owes any federal tax other than the income tax, net investment income tax and Additional Medicare Tax',
      'household employment taxes for a household employee (Schedule H)',
      "The estimate's current-year tax is the engine's liability computation, which takes the tax from the IRS Tax Table for taxable income under $100,000 as the return itself does, where Form 1040-ES's worksheet uses the rate schedules, so the two can differ by a few dollars.",
      'a return was filed for the preceding taxable year',
      'a taxable year of 12 months',
      'true is outside the list this tool supports',
      'Required when filingStatus is mfs, and refused by name as an unknown key for any other filing status.',
      '26 U.S.C. § 63(c)(6)(A)',
      'collects no itemized deductions and the engine would treat them as zero',
      'had income of any kind other than the wages, interest, dividends and net capital gains above',
      'any adjustment to income or any deduction other than the standard deduction',
      'claims any credit, such as the child tax credit',
      'The filer claims anyone as a dependent.',
      'was 65 or older, or blind, at the end of the tax year',
      "can be claimed as someone else's dependent"
    ];
    for (const phrase of phrases) assert.ok(text.includes(phrase), phrase);
  });

  test('ordinary dividends are box 1a and the engine receives box 1a minus box 1b', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin) });
      const equal = liabilityFacts({
        income: {
          wages: 0,
          medicareWages: 0,
          taxableInterest: 0,
          ordinaryDividends: 0.3,
          qualifiedDividends: 0.3,
          shortTermCapitalGains: 0,
          longTermCapitalGains: 0
        }
      });
      const equalFile = writeFacts(box.root, equal);
      const equalRun = await run(box, ['compute', '--facts', equalFile], { pin, options: { enginePath } });
      assert.equal(equalRun.result.exitCode, 0, equalRun.result.stderr);
      const equalIncome = received(enginePath).call.params.arguments.income;
      assert.equal(equalIncome.ordinaryDividends, '0.00');
      assert.equal(centsOf(equalIncome.qualifiedDividends), 30n);
      assert.equal(typeof equalIncome.qualifiedDividends, 'string');

      const over = liabilityFacts({
        income: {
          wages: 0,
          medicareWages: 0,
          taxableInterest: 0,
          ordinaryDividends: 10.25,
          qualifiedDividends: 0.1,
          shortTermCapitalGains: 0,
          longTermCapitalGains: 0
        }
      });
      const overFile = writeFacts(box.root, over);
      const overRun = await run(box, ['compute', '--facts', overFile], { pin, options: { enginePath } });
      assert.equal(overRun.result.exitCode, 0, overRun.result.stderr);
      const overIncome = received(enginePath).call.params.arguments.income;
      assert.equal(overIncome.ordinaryDividends, '10.15');
      assert.equal(centsOf(overIncome.qualifiedDividends), 10n);
      assert.equal(overIncome.qualifiedDividends, '0.10');

      rmSync(join(dirname(enginePath), 'received.json'), { force: true });
      const refusedFacts = liabilityFacts({
        income: {
          wages: 0,
          medicareWages: 0,
          taxableInterest: 0,
          ordinaryDividends: 4.1,
          qualifiedDividends: 10.25,
          shortTermCapitalGains: 0,
          longTermCapitalGains: 0
        }
      });
      const refusedFile = writeFacts(box.root, refusedFacts);
      const refusedRun = await run(box, ['compute', '--facts', refusedFile], { pin, options: { enginePath } });
      const body = refusal(refusedRun.result, 'INVALID_VALUE');
      assert.deepEqual(subjects(body), ['income.ordinaryDividends', 'income.qualifiedDividends']);
      assert.match(body.message, /income\.ordinaryDividends/);
      assert.match(body.message, /income\.qualifiedDividends/);
      assert.match(body.message, /box 1a/);
      assert.match(body.message, /box 1b/);
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('spouseItemizes is required for mfs, refused otherwise, and false is filed with the engine', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin, { valueCents: BIG_CENTS }) });

      for (const operation of ['liability', 'estimate']) {
        const facts = operation === 'estimate'
          ? estimateFacts({ filingStatus: 'mfs' })
          : liabilityFacts({ filingStatus: 'mfs' });
        const file = writeFacts(box.root, facts);
        const { result } = await run(box, ['compute', '--facts', file], { pin, options: { enginePath } });
        const body = refusal(result, 'FACTS_MISSING');
        assert.ok(subjects(body).includes('spouseItemizes'), operation);
        assert.equal(result.stderr.includes(BIG_CENTS), false);
      }
      assert.equal(received(enginePath), null);

      const wrongType = writeFacts(box.root, liabilityFacts({ filingStatus: 'mfs', spouseItemizes: 'no' }));
      const wrong = await run(box, ['compute', '--facts', wrongType], { pin, options: { enginePath } });
      assert.equal(refusal(wrong.result, 'INVALID_VALUE').subject, 'spouseItemizes');

      for (const operation of ['liability', 'estimate']) {
        const base = operation === 'estimate' ? estimateFacts() : liabilityFacts();
        const facts = { ...base, filingStatus: 'mfs', spouseItemizes: true };
        const file = writeFacts(box.root, facts);
        const { result } = await run(box, ['compute', '--facts', file], { pin, options: { enginePath } });
        const body = refusal(result, 'FEATURE_UNSUPPORTED');
        assert.equal(body.subject, 'spouseItemizes');
        assert.match(body.message, /outside the list this tool supports/);
        assert.match(body.message, /itemized deductions/);
        assert.equal(result.stderr.includes(BIG_CENTS), false);
      }
      assert.equal(received(enginePath), null);

      for (const filingStatus of ['single', 'mfj', 'hoh', 'qss']) {
        const file = writeFacts(box.root, liabilityFacts({ filingStatus, spouseItemizes: false }));
        const { result } = await run(box, ['compute', '--facts', file], { pin, options: { enginePath } });
        const body = refusal(result, 'UNKNOWN_KEY');
        assert.equal(body.subject, 'spouseItemizes', filingStatus);
      }
      assert.equal(received(enginePath), null);

      const passed = writeFacts(box.root, liabilityFacts({ filingStatus: 'mfs', spouseItemizes: false }));
      const passedRun = await run(box, ['compute', '--facts', passed], { pin, options: { enginePath } });
      assert.equal(passedRun.result.exitCode, 0, passedRun.result.stderr);
      const filing = received(enginePath).call.params.arguments.filing;
      assert.deepEqual(filing, { filingStatus: 'mfs', spouseItemizes: false });
      assert.equal(received(enginePath).call.params.arguments.spouseItemizes, undefined);

      const estimatePassed = writeFacts(box.root, estimateFacts({ filingStatus: 'mfs', spouseItemizes: false }));
      const estimateRun = await run(box, ['compute', '--facts', estimatePassed], { pin, options: { enginePath } });
      assert.equal(estimateRun.result.exitCode, 0, estimateRun.result.stderr);
      const estimateCall = received(enginePath).call.params.arguments;
      assert.deepEqual(estimateCall.filing, { filingStatus: 'mfs', spouseItemizes: false });
      assert.equal(estimateCall.payments_estimates.spouseItemizes, undefined);
      assert.equal(estimateCall.payments_estimates.isFarmerOrFisherman, false);

      for (const operation of ['liability', 'estimate']) {
        const assumptions = [{
          factId: 'spouseItemizes',
          value: { type: 'bool', value: false },
          source: 'default',
          rationale: 'Assumed the spouse does not itemize absent contrary input'
        }];
        const defaultEngine = placeStub(box.root, {
          mode: 'ok',
          result: okResult(pin, { valueCents: BIG_CENTS, assumptions })
        });
        const base = operation === 'estimate'
          ? estimateFacts({ filingStatus: 'mfs', spouseItemizes: false })
          : liabilityFacts({ filingStatus: 'mfs', spouseItemizes: false });
        const file = writeFacts(box.root, base);
        const { result } = await run(box, ['compute', '--facts', file], { pin, options: { enginePath: defaultEngine } });
        const body = refusal(result, 'FACTS_DEFAULTED');
        assert.equal(body.subject, 'spouseItemizes', operation);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr.includes(BIG_CENTS), false);
      }

      const mfjEngine = placeStub(box.root, {
        mode: 'ok',
        result: okResult(pin, {
          assumptions: [{
            factId: 'spouseItemizes',
            value: { type: 'bool', value: false },
            source: 'default',
            rationale: 'Assumed the spouse does not itemize absent contrary input'
          }]
        })
      });
      const mfj = writeFacts(box.root, liabilityFacts());
      const mfjRun = await run(box, ['compute', '--facts', mfj], { pin, options: { enginePath: mfjEngine } });
      assert.equal(mfjRun.result.exitCode, 0, mfjRun.result.stderr);
      assert.equal(received(mfjEngine).call.params.arguments.filing.spouseItemizes, undefined);
    } finally {
      box.cleanup();
    }
  });

  test('an annualized target sent with estimate facts is refused by its own name', async () => {
    const box = sandbox();
    try {
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin, { valueCents: BIG_CENTS }) });
      const operation = 'us.federal.estimated.annualized_installment_q2';
      const facts = writeFacts(box.root, estimateFacts({ operation, notARealFact: 1 }));
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      const body = refusal(result, 'FEATURE_UNSUPPORTED');
      assert.equal(body.subject, operation);
      assert.match(body.message, /annualized installment method is not computed by this tool/);
      assert.equal(body.subject === 'estimate', false);
      assert.equal(result.stderr.includes('UNKNOWN_KEY'), false);
      assert.equal(result.stderr.includes(BIG_CENTS), false);
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('a numeric lexeme is refused as written, before any rounding', async () => {
    const box = sandbox();
    try {
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pinFor(BUNDLE_BYTES), { valueCents: BIG_CENTS }) });
      const base = JSON.stringify(liabilityFacts());
      const cases = [
        [base.replace('"taxYear":2025', '"taxYear":2025.0000000000000001'), 'taxYear'],
        [base.replace('"wages":150000', '"wages":1.0000000000000001'), 'income.wages'],
        [base.replace('"wages":150000', '"wages":-1e-400'), 'income.wages'],
        [base.replace('"wages":150000', '"wages":1e2'), 'income.wages']
      ];
      for (const [text, key] of cases) {
        const file = join(box.root, 'facts.json');
        writeFileSync(file, `${text}\n`);
        const { result } = await run(box, ['compute', '--facts', file], { options: { enginePath } });
        const body = refusal(result, 'INVALID_VALUE');
        assert.equal(body.subject, key, text);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr.includes(BIG_CENTS), false);
      }
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('every money amount with cents is sent as a decimal string', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin, { valueCents: '250000' }) });
      const facts = writeFacts(box.root, estimateFacts({
        income: {
          wages: 150000.01,
          medicareWages: 160000.5,
          taxableInterest: 0.1,
          ordinaryDividends: 10.25,
          qualifiedDividends: 0.1,
          shortTermCapitalGains: 1.2,
          longTermCapitalGains: 3.04
        },
        estimate: {
          ...estimateFacts().estimate,
          federalTaxWithheld: 6000.01,
          priorYearTax: 10000.1,
          priorYearAGI: 140000.2
        }
      }));
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      assert.equal(result.exitCode, 0, result.stderr);
      const call = received(enginePath).calls
        .map((entry) => entry.params.arguments)
        .find((item) => item.target === 'us.federal.estimated.quarterly_payment');
      const amounts = [
        ...Object.values(call.income),
        call.payments_estimates.federalTaxWithheld,
        call.payments_estimates.priorYearTax,
        call.payments_estimates.priorYearAGI
      ];
      for (const amount of amounts) {
        assert.equal(typeof amount, 'string', amount);
        assert.match(amount, /^\d+\.\d{2}$/);
      }
      assert.equal(call.income.wages, '150000.01');
      assert.equal(call.income.medicareWages, '160000.50');
      assert.equal(call.income.taxableInterest, '0.10');
      assert.equal(call.income.ordinaryDividends, '10.15');
      assert.equal(call.income.qualifiedDividends, '0.10');
      assert.equal(call.income.shortTermCapitalGains, '1.20');
      assert.equal(call.income.longTermCapitalGains, '3.04');
      assert.equal(call.payments_estimates.federalTaxWithheld, '6000.01');
      assert.equal(call.payments_estimates.priorYearTax, '10000.10');
      assert.equal(call.payments_estimates.priorYearAGI, '140000.20');
      assert.equal(call.profile, undefined);
      assert.equal(JSON.stringify(call).includes('otherIncome'), false);
    } finally {
      box.cleanup();
    }
  });

  test('each profile attestation is refused when true and when absent', async () => {
    const names = [
      'otherIncome',
      'adjustmentsOrItemizing',
      'credits',
      'dependents',
      'ageOrBlindness',
      'claimableAsDependent',
      'otherTaxes'
    ];
    const box = sandbox();
    try {
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pinFor(BUNDLE_BYTES), { valueCents: BIG_CENTS }) });
      for (const operation of ['liability', 'estimate']) {
        for (const name of names) {
          const base = operation === 'estimate' ? estimateFacts() : liabilityFacts();
          const facts = writeFacts(box.root, {
            ...base,
            profile: supportedProfile({ [name]: true })
          });
          const { result } = await run(box, ['compute', '--facts', facts], { options: { enginePath } });
          const body = refusal(result, 'FEATURE_UNSUPPORTED');
          assert.equal(body.subject, `profile.${name}`, operation);
          assert.equal(result.stderr.includes(BIG_CENTS), false);
        }
        for (const name of names) {
          const profile = supportedProfile();
          delete profile[name];
          const base = operation === 'estimate' ? estimateFacts() : liabilityFacts();
          const facts = writeFacts(box.root, { ...base, profile });
          const { result } = await run(box, ['compute', '--facts', facts], { options: { enginePath } });
          const body = refusal(result, 'FACTS_MISSING');
          assert.equal(body.subject, `profile.${name}`, operation);
        }
      }
      const gone = liabilityFacts();
      delete gone.profile;
      const missing = writeFacts(box.root, gone);
      const { result } = await run(box, ['compute', '--facts', missing], { options: { enginePath } });
      assert.deepEqual(subjects(refusal(result, 'FACTS_MISSING')), names.map((name) => `profile.${name}`));
      const wages = estimateFacts();
      delete wages.income.medicareWages;
      const wageFile = writeFacts(box.root, wages);
      const wageRun = await run(box, ['compute', '--facts', wageFile], { options: { enginePath } });
      assert.equal(refusal(wageRun.result, 'FACTS_MISSING').subject, 'income.medicareWages');
      assert.equal(received(enginePath), null);
    } finally {
      box.cleanup();
    }
  });

  test('a defaulted medicare wage is refused with no figure', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, {
        mode: 'ok',
        result: okResult(pin, {
          valueCents: BIG_CENTS,
          assumptions: [{
            factId: 'medicareWages',
            value: { type: 'money', value: '0' },
            source: 'default',
            rationale: 'Approximated by box 1 wages absent contrary input'
          }]
        })
      });
      const facts = writeFacts(box.root, liabilityFacts());
      const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
      const body = refusal(result, 'FACTS_DEFAULTED');
      assert.equal(body.subject, 'medicareWages');
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.includes(BIG_CENTS), false);
    } finally {
      box.cleanup();
    }
  });

  test('section 6654(e)(1) from the engine balance and required payment, and a broken input returns no figure', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const quarterly = 'us.federal.estimated.quarterly_payment';
      const balanceDue = 'us.federal.balance_due';
      const requiredAnnual = 'us.federal.estimated.required_annual_payment';
      const engine = (installmentCents, balanceCents, requiredCents, extra = {}) => placeStub(box.root, {
        mode: 'ok',
        result: okResult(pin, { valueCents: installmentCents, answer: 'DECOY', target: quarterly }),
        byTarget: {
          [balanceDue]: okResult(pin, { valueCents: balanceCents, answer: 'DECOY', target: balanceDue, ...(extra.balance || {}) }),
          [requiredAnnual]: okResult(pin, { valueCents: requiredCents, answer: 'DECOY', target: requiredAnnual, ...(extra.required || {}) })
        }
      });
      const facts = writeFacts(box.root, estimateFacts());

      const below = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath: engine('9630', '42800', '1000000') } });
      assert.equal(below.result.exitCode, 0, below.result.stderr);
      const belowBody = JSON.parse(below.result.stdout);
      assert.equal(belowBody.figure.valueCents, '0');
      assert.equal(belowBody.figure.dollars, '$0.00');
      assert.equal(belowBody.figure.label, 'No required quarterly estimated payment under 26 U.S.C. § 6654(e)');
      assert.equal(belowBody.estimateDetail.determination, true);
      assert.equal(belowBody.estimateDetail.fourRequiredInstallments, false);
      assert.equal(belowBody.estimateDetail.regularMethodInstallment.valueCents, '9630');
      assert.equal(belowBody.estimateDetail.regularMethodInstallment.dollars, '$96.30');

      const refund = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath: engine('9630', '-50000', '1000000') } });
      assert.equal(refund.result.exitCode, 0, refund.result.stderr);
      assert.equal(JSON.parse(refund.result.stdout).estimateDetail.determination, true);

      const atLimit = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath: engine('25000', '100000', '1000000') } });
      assert.equal(atLimit.result.exitCode, 0, atLimit.result.stderr);
      const atBody = JSON.parse(atLimit.result.stdout);
      assert.equal(atBody.figure.valueCents, '25000');
      assert.equal(atBody.figure.label, 'Required quarterly estimated payment by the regular installment method');
      assert.equal(atBody.estimateDetail.determination, false);
      assert.equal(atBody.estimateDetail.fourRequiredInstallments, true);

      const coveredFacts = writeFacts(box.root, estimateFacts({
        estimate: { ...estimateFacts().estimate, federalTaxWithheld: 50 }
      }));
      const covered = await run(box, ['compute', '--facts', coveredFacts], { pin, options: { enginePath: engine('9630', '200000', '5000') } });
      assert.equal(covered.result.exitCode, 0, covered.result.stderr);
      const coveredBody = JSON.parse(covered.result.stdout);
      assert.equal(coveredBody.figure.valueCents, '0');
      assert.equal(coveredBody.estimateDetail.determination, true);

      const short = await run(box, ['compute', '--facts', coveredFacts], { pin, options: { enginePath: engine('9630', '200000', '5001') } });
      assert.equal(short.result.exitCode, 0, short.result.stderr);
      assert.equal(JSON.parse(short.result.stdout).estimateDetail.determination, false);

      const badRoot = await run(box, ['compute', '--facts', facts], {
        pin,
        options: { enginePath: engine('9630', '42800', '1000000', { balance: { corpusMerkleRoot: BAD_ROOT } }) }
      });
      const badRootBody = refusal(badRoot.result, 'PIN_ROOT');
      assert.equal(badRootBody.subject, 'corpusMerkleRoot');
      assert.equal(badRoot.result.stderr.includes('9630'), false);
      assert.equal(badRoot.result.stderr.includes('DECOY'), false);

      const wrongTarget = await run(box, ['compute', '--facts', facts], {
        pin,
        options: { enginePath: engine('9630', '42800', '1000000', { balance: { target: 'us.federal.net_tax', asOf: '2025-12-31', forceIdentity: true } }) }
      });
      const wrongBody = faultBody(wrongTarget.result, 'RESULT_MISMATCH');
      assert.match(wrongBody.message, /us\.federal\.net_tax/);
      assert.equal(wrongTarget.result.stdout, '');
      assert.equal(wrongTarget.result.stderr.includes('9630'), false);

      const badRequiredRoot = await run(box, ['compute', '--facts', facts], {
        pin,
        options: { enginePath: engine('9630', '200000', '1000000', { required: { corpusMerkleRoot: BAD_ROOT } }) }
      });
      const badRequiredBody = refusal(badRequiredRoot.result, 'PIN_ROOT');
      assert.equal(badRequiredBody.subject, 'corpusMerkleRoot');
      assert.equal(badRequiredRoot.result.stderr.includes('9630'), false);

      const unreadable = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath: engine('9630', '12.5', '1000000') } });
      faultBody(unreadable.result, 'ENGINE_UNREADABLE');
    } finally {
      box.cleanup();
    }
  });

  test('medicare wages of zero with wages above zero are refused, and zero for both is accepted', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin, { valueCents: BIG_CENTS, answer: 'DECOY' }) });
      for (const operation of ['liability', 'estimate']) {
        const base = operation === 'estimate' ? estimateFacts() : liabilityFacts();
        const facts = writeFacts(box.root, {
          ...base,
          income: { ...base.income, wages: 52000, medicareWages: 0 }
        });
        const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
        const body = refusal(result, 'FEATURE_UNSUPPORTED');
        assert.equal(body.subject, 'income.medicareWages', operation);
        assert.match(body.message, /reads a zero box 5 as absent/);
        assert.match(body.message, /substitutes box 1/);
        assert.match(body.message, /wages exempt from Medicare tax are outside this tool/);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr.includes(BIG_CENTS), false);
        assert.equal(result.stderr.includes('DECOY'), false);
      }
      assert.equal(received(enginePath), null);

      const acceptedIncome = {
        ...liabilityFacts().income,
        wages: 0,
        medicareWages: 0
      };
      const liabilityFile = writeFacts(box.root, liabilityFacts({ income: acceptedIncome }));
      const accepted = await run(box, ['compute', '--facts', liabilityFile], { pin, options: { enginePath } });
      assert.equal(accepted.result.exitCode, 0, accepted.result.stderr);
      const sent = received(enginePath).call.params.arguments.income;
      assert.equal(sent.wages, '0.00');
      assert.equal(sent.medicareWages, '0.00');

      const estimateFile = writeFacts(box.root, estimateFacts({ income: acceptedIncome }));
      const acceptedEstimate = await run(box, ['compute', '--facts', estimateFile], { pin, options: { enginePath } });
      assert.equal(acceptedEstimate.result.exitCode, 0, acceptedEstimate.result.stderr);
      const estimateSent = received(enginePath).calls
        .map((entry) => entry.params.arguments)
        .find((item) => item.target === 'us.federal.estimated.quarterly_payment');
      assert.equal(estimateSent.income.wages, '0.00');
      assert.equal(estimateSent.income.medicareWages, '0.00');
    } finally {
      box.cleanup();
    }
  });

  test('priorYearAdjusted true is refused, absence is missing, and false is not sent', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const enginePath = placeStub(box.root, { mode: 'ok', result: okResult(pin, { valueCents: BIG_CENTS, answer: 'DECOY' }) });
      const turnedOn = estimateFacts();
      turnedOn.estimate = { ...turnedOn.estimate, priorYearAdjusted: true };
      const trueFile = writeFacts(box.root, turnedOn);
      const { result } = await run(box, ['compute', '--facts', trueFile], { pin, options: { enginePath } });
      const body = refusal(result, 'FEATURE_UNSUPPORTED');
      assert.equal(body.subject, 'estimate.priorYearAdjusted');
      assert.match(body.message, /refundable credit/);
      assert.match(body.message, /6654\(d\)\(1\)\(B\)/);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.includes(BIG_CENTS), false);
      assert.equal(result.stderr.includes('DECOY'), false);

      const absent = estimateFacts();
      delete absent.estimate.priorYearAdjusted;
      const absentFile = writeFacts(box.root, absent);
      const missing = await run(box, ['compute', '--facts', absentFile], { pin, options: { enginePath } });
      assert.equal(refusal(missing.result, 'FACTS_MISSING').subject, 'estimate.priorYearAdjusted');
      assert.equal(received(enginePath), null);

      const kept = writeFacts(box.root, estimateFacts());
      const sent = await run(box, ['compute', '--facts', kept], { pin, options: { enginePath } });
      assert.equal(sent.result.exitCode, 0, sent.result.stderr);
      for (const call of received(enginePath).calls.map((entry) => entry.params.arguments)) {
        assert.equal(JSON.stringify(call).includes('priorYearAdjusted'), false);
        assert.equal(call.payments_estimates.priorYearTax, '10000.00');
      }
    } finally {
      box.cleanup();
    }
  });

  test('an answer with no target or no asOf is a mismatch fault with no figure', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const facts = writeFacts(box.root, liabilityFacts());
      const missingTarget = okResult(pin, { valueCents: BIG_CENTS, answer: '$0.01 DECOY' });
      delete missingTarget.target;
      const missingAsOf = okResult(pin, { valueCents: BIG_CENTS, answer: '$0.01 DECOY' });
      delete missingAsOf.asOf;
      for (const result of [missingTarget, missingAsOf]) {
        const enginePath = placeStub(box.root, { mode: 'ok', keepResultIdentity: true, result });
        const runResult = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
        const body = faultBody(runResult.result, 'RESULT_MISMATCH');
        assert.match(body.message, /differs from the request/);
        assert.match(body.message, /us\.federal\.net_tax/);
        assert.match(body.message, /none/);
        assert.equal(body.figure, undefined);
        assert.equal(runResult.result.stdout, '');
        assert.equal(runResult.result.stderr.includes(BIG_CENTS), false);
        assert.equal(runResult.result.stderr.includes('DECOY'), false);
        assert.equal(runResult.result.stderr.includes('$'), false);
      }
    } finally {
      box.cleanup();
    }
  });

  test('a needed fact defaulted on the balance or the required payment is refused with no figure', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const quarterly = 'us.federal.estimated.quarterly_payment';
      const balanceDue = 'us.federal.balance_due';
      const requiredAnnual = 'us.federal.estimated.required_annual_payment';
      const clean = (cents, target) => okResult(pin, { valueCents: cents, answer: 'DECOY', target });
      const defaulted = (cents, target) => okResult(pin, {
        valueCents: cents,
        answer: 'DECOY',
        target,
        assumptions: [{
          factId: 'priorYearTax',
          value: { type: 'money', value: '0' },
          source: 'default',
          rationale: 'Assumed no prior-year tax absent contrary input'
        }]
      });
      const facts = writeFacts(box.root, estimateFacts());
      const cases = [
        {
          [balanceDue]: defaulted('42800', balanceDue),
          [requiredAnnual]: clean('1000000', requiredAnnual)
        },
        {
          [balanceDue]: clean('200000', balanceDue),
          [requiredAnnual]: defaulted('1000000', requiredAnnual)
        }
      ];
      for (const byTarget of cases) {
        const enginePath = placeStub(box.root, {
          mode: 'ok',
          result: clean('9630', quarterly),
          byTarget
        });
        const { result } = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
        const body = refusal(result, 'FACTS_DEFAULTED');
        assert.equal(body.subject, 'priorYearTax');
        assert.equal(body.figure, undefined);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr.includes('9630'), false);
        assert.equal(result.stderr.includes('42800'), false);
        assert.equal(result.stderr.includes('1000000'), false);
        assert.equal(result.stderr.includes('DECOY'), false);
        assert.equal(result.stderr.includes('$'), false);
      }
    } finally {
      box.cleanup();
    }
  });

  test('a result whose target or asOf differs from the request is a fault with no figure', async () => {
    const box = sandbox();
    try {
      installTree(box.toolDir);
      const pin = pinFor(BUNDLE_BYTES);
      const facts = writeFacts(box.root, liabilityFacts());
      const cases = [
        okResult(pin, { valueCents: BIG_CENTS, answer: '$0.01 DECOY', target: 'us.federal.balance_due', asOf: '2025-12-31' }),
        okResult(pin, { valueCents: BIG_CENTS, answer: '$0.01 DECOY', target: 'us.federal.net_tax', asOf: '2024-12-31' })
      ];
      for (const result of cases) {
        const enginePath = placeStub(box.root, { mode: 'ok', keepResultIdentity: true, result });
        const runResult = await run(box, ['compute', '--facts', facts], { pin, options: { enginePath } });
        const body = faultBody(runResult.result, 'RESULT_MISMATCH');
        assert.match(body.message, /differs from the request/);
        assert.equal(runResult.result.stdout, '');
        assert.equal(runResult.result.stderr.includes(BIG_CENTS), false);
        assert.equal(runResult.result.stderr.includes('DECOY'), false);
      }
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
