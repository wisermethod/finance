/**
 * Tax Engine core. Node built-ins only. The entry script calls main; tests
 * import main and pass a stub engine and a pin as parameters. No flag, no
 * environment variable, and no facts key changes the engine path, the pin,
 * the child's environment, or the child's arguments.
 *
 * The engine is AGPL-3.0-only. This tool does not import it, vendor it, or
 * copy it. An authorised install fetches it, and compute starts bundle/index.js
 * as a child process.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installAuthorised, parsedInstallFlag, writeConsent } from './consent.js';

const HELP_CMD = 'node scripts/tax-engine.js help';
const TOOL_NAME = 'Tax Engine';
const DEFAULT_TIMEOUT_MS = 30000;
const FETCH_PACKAGE = '@invaro/opentax@0.4.0';
const FETCH_HOST = 'registry.npmjs.org';
const FETCH_BYTES = 5131493;
const STATEMENT = 'This is computation, not tax advice, and not a substitute for a licensed CPA, enrolled agent, or other tax professional.';
const ESTIMATE_STATEMENT = 'The figure is each of four required installments by the regular installment method. Withholding is treated as paid evenly. The annualized installment method was not computed.';
const SAFE_HARBOR_STATEMENT = 'No required quarterly estimated payment under 26 U.S.C. § 6654(e). The regular-method installment is carried with this answer. Withholding is treated as paid evenly. The annualized installment method was not computed.';
const LIABILITY_LABEL = 'Federal total tax, Form 1040 line 24, less refundable credits';
const ESTIMATE_LABEL = 'Required quarterly estimated payment by the regular installment method';
const SAFE_HARBOR_LABEL = 'No required quarterly estimated payment under 26 U.S.C. § 6654(e)';
const UNREADABLE = 'The engine returned a response this tool could not read, so no figure is returned. Fix: confirm the installed engine is @invaro/opentax 0.4.0 and run the command again.';
const NET_TAX_TARGET = 'us.federal.net_tax';
const QUARTERLY_TARGET = 'us.federal.estimated.quarterly_payment';
const BALANCE_DUE_TARGET = 'us.federal.balance_due';
const REQUIRED_ANNUAL_TARGET = 'us.federal.estimated.required_annual_payment';
// 26 U.S.C. § 6654(e)(1): the addition to tax is not imposed when the balance
// due after withholding is below $1,000.
const SAFE_HARBOR_BALANCE_CENTS = 100000n;

const INCOME_FIELDS = [
  'wages',
  'medicareWages',
  'taxableInterest',
  'ordinaryDividends',
  'qualifiedDividends',
  'shortTermCapitalGains',
  'longTermCapitalGains'
];
const PROFILE_FIELDS = [
  'otherIncome',
  'adjustmentsOrItemizing',
  'credits',
  'dependents',
  'ageOrBlindness',
  'claimableAsDependent'
];
const ESTIMATE_FIELDS = [
  'federalTaxWithheld',
  'priorYearTax',
  'priorYearAGI',
  'priorYearReturnFiled',
  'priorYearTwelveMonths',
  'farmerOrFisherman'
];
const AMOUNT_FIELDS = ['federalTaxWithheld', 'priorYearTax', 'priorYearAGI'];
const BOOLEAN_FIELDS = ['priorYearReturnFiled', 'priorYearTwelveMonths', 'farmerOrFisherman'];

// Closed lists of the facts each operation needs, and the engine fact each one maps to.
// priorYearReturnFiled and priorYearTwelveMonths are not engine facts; this tool gates them.
// spouseItemizes is added for both operations when filingStatus is mfs. The engine
// fact has no default, and it lives in the engine's filing group.
const LIABILITY_NEEDED = [
  ['filingStatus', 'filingStatus'],
  ...INCOME_FIELDS.map((name) => [`income.${name}`, name])
];
const ESTIMATE_NEEDED = [
  ...LIABILITY_NEEDED,
  ['estimate.federalTaxWithheld', 'federalTaxWithheld'],
  ['estimate.priorYearTax', 'priorYearTax'],
  ['estimate.priorYearAGI', 'priorYearAGI'],
  ['estimate.priorYearReturnFiled', null],
  ['estimate.priorYearTwelveMonths', null],
  ['estimate.farmerOrFisherman', 'isFarmerOrFisherman']
];
const LIABILITY_ENGINE_FACTS = LIABILITY_NEEDED.map((pair) => pair[1]);
const ESTIMATE_ENGINE_FACTS = ESTIMATE_NEEDED.map((pair) => pair[1]).filter(Boolean);

const FILING = new Set(['single', 'mfj', 'mfs', 'hoh', 'qss']);
const ANNUALIZED = new Set([
  'us.federal.estimated.annualized_installment_q1',
  'us.federal.estimated.annualized_installment_q2',
  'us.federal.estimated.annualized_installment_q3',
  'us.federal.estimated.annualized_installment_q4'
]);
const PIN_KEYS = [
  'packageName',
  'packageVersion',
  'bundleSha256',
  'corpusName',
  'corpusVersion',
  'corpusMerkleRoot',
  'nodeRecorded'
];
const VALUE_FLAGS = new Set(['--facts']);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TOOL_DIR = resolve(SCRIPT_DIR, '..');

export const HELP = `Tax Engine computes one federal figure. It gives no tax advice, fills no form, and does not replace a licensed CPA, enrolled agent, or other tax professional.

Usage:
  node scripts/tax-engine.js help
  node scripts/tax-engine.js --help
  node scripts/tax-engine.js compute --facts <absolute path> [--install]
  node scripts/tax-engine.js check [--install]

Commands:
  help       Print this message. Needs nothing installed.
  compute    Read one JSON facts file and compute a federal figure.
  check      Report whether the engine is absent, complete, or incomplete, whether the installed bundle matches the pin, and the versions the pin holds. Computes nothing and starts no engine.

Flags:
  --facts <absolute path>   Facts file for compute. A relative path is refused by name.
  --install                 Authorise the first install in this copy and finish the run.
                            On compute, WISER_ALLOW_INSTALL=1 does the same for an unattended run.
                            On check, only --install installs. A check without --install never writes the consent marker.
  --help                    Print this message.

Fact vocabulary. The file is one JSON object. Every key below is required unless a line says otherwise. Any other key, at any level, is refused by name before the engine starts. Zero is a value you state, not a default.

  operation        "liability" or "estimate"
                   liability: the federal total tax, Form 1040 line 24, less refundable credits: income tax
                     plus self-employment tax, net investment income tax and Additional Medicare Tax, less refundable credits
                     engine target us.federal.net_tax
                   estimate: the required quarterly estimated payment by the regular installment method.
                     The tool also asks the engine for us.federal.balance_due and us.federal.estimated.required_annual_payment and applies 26 U.S.C. § 6654(e)(1):
                     when the balance due after withholding is below $1,000, or the withholding stated reaches the required annual payment, the figure is zero,
                     no required quarterly estimated payment under 26 U.S.C. § 6654(e), and the answer still carries the regular-method installment and the determination.
                     Otherwise the figure is the regular-method installment.
                     engine target us.federal.estimated.quarterly_payment
                   Each of these, given as operation, is refused by its own name. The annualized installment method is not computed by this tool:
                     us.federal.estimated.annualized_installment_q1
                     us.federal.estimated.annualized_installment_q2
                     us.federal.estimated.annualized_installment_q3
                     us.federal.estimated.annualized_installment_q4
                   Any other engine target name, such as us.federal.estimated.safe_harbor_met, is refused by its own name the same way.
  jurisdiction     "federal"
                   A jurisdiction of co or Colorado, in any case and with surrounding space, is refused by name: nothing this tool runs computes Colorado.
                   Any other jurisdiction is refused as unsupported.
  taxYear          the digits 2025 or 2026, with no decimal point and no exponent. The tool asks the engine for that year's 31 December.
  filingStatus     single, mfj, mfs, hoh, or qss
  profile          an object with exactly these keys, each a boolean. Each must be false for a figure to be computed.
                   true is outside what this tool computes. None of these is sent to the engine.
                     otherIncome
                       The filer or spouse had income of any kind other than the wages, interest, dividends and net capital gains above, such as self-employment or business income, rental income, retirement plan or IRA distributions, Social Security benefits, unemployment compensation or alimony, or had a net capital loss.
                     adjustmentsOrItemizing
                       The filer or spouse has any adjustment to income or any deduction other than the standard deduction, such as IRA, HSA or self-employed retirement contributions, student loan interest, educator expenses, the deductions for qualified tips, qualified overtime, car loan interest or seniors, or itemizes.
                     credits
                       The filer or spouse claims any credit, such as the child tax credit, the credit for other dependents, an education, child and dependent care, energy, adoption, foreign tax, earned income or premium tax credit, or a credit for excess Social Security tax withheld.
                     dependents
                       The filer claims anyone as a dependent.
                     ageOrBlindness
                       The filer or spouse was 65 or older, or blind, at the end of the tax year.
                     claimableAsDependent
                       The filer or spouse can be claimed as someone else's dependent.
  income           an object with exactly these keys, each an amount: digits, with an optional decimal point and one or two digits after it, zero or greater. A sign or an exponent is refused. The engine receives each amount as an exact decimal string built from those whole cents.
                     wages
                       The year's wages, Form W-2 box 1, summed over every W-2.
                     medicareWages
                       The year's Medicare wages and tips, Form W-2 box 5, summed over every W-2. An amount, as for wages.
                     taxableInterest
                       The year's taxable interest, Form 1099-INT box 1 plus box 3.
                     ordinaryDividends
                       The year's total ordinary dividends, Form 1099-DIV box 1a, qualified dividends included.
                       The engine is given box 1a minus box 1b, computed in whole cents.
                     qualifiedDividends
                       Qualified dividends, Form 1099-DIV box 1b.
                       A qualifiedDividends greater than ordinaryDividends is refused, naming both.
                     shortTermCapitalGains
                       The net short-term capital gain after netting, zero where the net is a loss.
                       A net capital loss is outside what this tool computes.
                     longTermCapitalGains
                       The net long-term capital gain after netting, zero where the net is a loss.
                       A net capital loss is outside what this tool computes.
  spouseItemizes   boolean. Required when filingStatus is mfs, and refused by name as an unknown key for any other filing status.
                   false: the spouse does not itemize deductions on a separate return (26 U.S.C. § 63(c)(6)(A)). Passed to the engine in its filing group.
                   true is outside the list this tool supports, because this tool collects no itemized deductions and the engine would treat them as zero.
  estimate         required when operation is estimate, and refused by name when operation is liability.
                   An object with exactly these keys:
                     federalTaxWithheld
                       All federal income tax withheld for the year: Form W-2 box 2, Additional Medicare Tax withheld (box 6 above 1.45% of box 5), and box 4 of every Form 1099-INT and 1099-DIV.
                       The federal income tax withheld for the whole tax year, already withheld plus still to be withheld, Form W-2 box 2,
                       plus any Additional Medicare Tax withheld (Form W-2 box 6 above 1.45% of box 5), summed over every W-2.
                       Estimated payments are excluded, because the regular installment method treats withholding, and only withholding, as paid evenly through the year (26 U.S.C. § 6654(g)).
                       The engine's own description also folds in estimated payments. This tool's definition does not.
                     priorYearTax
                       The total tax shown on the preceding year's return. Amount, as for income.
                     priorYearAGI
                       The adjusted gross income shown on the preceding year's return. Amount, as for income.
                     priorYearReturnFiled
                       boolean; a return was filed for the preceding taxable year
                     priorYearTwelveMonths
                       boolean; that year was a taxable year of 12 months
                     farmerOrFisherman
                       boolean; true is outside the list this tool supports

check prints one JSON object and exits 0. Its engine field is absent, complete, or incomplete. bundleMatchesPin and packageVersionMatchesPin are true, false, or null. pin holds the package name and version, the bundle hash, the corpus name and version, the corpus root, and the Node version the pin recorded.

A refusal prints one JSON object to stderr, leaves stdout empty, and exits 1. It carries refused true, a code, the subject it names, a message with the cause and the fix, and the pinned package version, corpus version, and corpus root labelled expected. An engine crash, timeout, or unreadable answer exits 1 with refused false, and with no figure.
`;

function helpResult() {
  return { exitCode: 0, stdout: HELP.endsWith('\n') ? HELP : `${HELP}\n`, stderr: '' };
}

function usageError(message) {
  return { exitCode: 1, stdout: '', stderr: message.endsWith('\n') ? message : `${message}\n` };
}

function jsonOut(exitCode, body) {
  return { exitCode, stdout: exitCode === 0 ? `${JSON.stringify(body)}\n` : '', stderr: exitCode === 0 ? '' : `${JSON.stringify(body)}\n` };
}

function expectedProvenance(pin) {
  return {
    expected: {
      packageName: pin.packageName,
      packageVersion: pin.packageVersion,
      corpusName: pin.corpusName,
      corpusVersion: pin.corpusVersion,
      corpusRoot: pin.corpusMerkleRoot
    }
  };
}

function refusal(pin, code, subject, message) {
  return jsonOut(1, {
    refused: true,
    code,
    subject,
    message,
    provenance: expectedProvenance(pin)
  });
}

function fault(code, message) {
  return jsonOut(1, { refused: false, code, message });
}

class JsonNumber {
  constructor(lexeme) {
    this.lexeme = lexeme;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof JsonNumber);
}

function packageMarker(toolDir) {
  return join(toolDir, 'node_modules', '@invaro', 'opentax', 'package.json');
}

function bundleFile(toolDir) {
  return join(toolDir, 'node_modules', '@invaro', 'opentax', 'bundle', 'index.js');
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function loadPin(toolDir) {
  try {
    const pin = JSON.parse(readFileSync(join(toolDir, 'pin.json'), 'utf8'));
    return validPin(pin) ? pin : null;
  } catch {
    return null;
  }
}

function validPin(pin) {
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) return false;
  return PIN_KEYS.every((key) => typeof pin[key] === 'string' && pin[key].length > 0);
}

function nodeMajor(version) {
  const major = Number(String(version).replace(/^v/, '').split('.')[0]);
  return Number.isFinite(major) ? major : 0;
}

function isWritable(dir) {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function dependencyReport(toolDir) {
  return usageError(
    `Error: this tool is not installed yet and this copy of the plugin has not authorised an install. The plugin asks once, on the first install in this copy. Installing fetches ${FETCH_PACKAGE} from ${FETCH_HOST} into ${toolDir}, ${FETCH_BYTES} bytes unpacked, and npm writes its own cache outside this plugin. Re-run the same command with --install to authorise it, or set WISER_ALLOW_INSTALL=1 for an unattended run. Nothing is read from stdin, so this is the only way to answer.`
  );
}

async function defaultRunInstall(toolDir) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: toolDir,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: process.env,
    timeout: 180000
  });
}

async function ensureInstalled({ toolDir, fromFile, install, env, runInstall, allowVariable, nodeVersion }) {
  if (existsSync(packageMarker(toolDir))) return { note: '' };
  const authorised = allowVariable ? installAuthorised(fromFile, install, env) : install === true;
  if (!authorised) return { error: dependencyReport(toolDir) };
  const version = nodeVersion || process.versions.node;
  if (nodeMajor(version) < 20) {
    return {
      error: usageError(
        `Error: npm ci cannot run because this is Node ${version} and this tool needs Node 20 or newer. Install Node 20 or newer and run the same command with --install again.`
      )
    };
  }
  if (!isWritable(toolDir)) {
    return {
      error: usageError(
        `Error: cannot install dependencies because ${toolDir} is not writable. This tool installs its dependencies into its own directory on the run that authorises it with --install, so that directory has to be writable. Install this plugin somewhere you own, or make that directory writable, then run the command again.`
      )
    };
  }
  writeConsent(fromFile, TOOL_NAME, install, env);
  try {
    await Promise.resolve(runInstall(toolDir));
  } catch (error) {
    if (!isWritable(toolDir)) {
      return {
        error: usageError(
          `Error: cannot install dependencies because ${toolDir} is not writable. This tool installs its dependencies into its own directory on the run that authorises it with --install, so that directory has to be writable. Install this plugin somewhere you own, or make that directory writable, then run the command again.`
        )
      };
    }
    const detail = error && error.stderr ? String(error.stderr).trim() : '';
    const tail = detail ? `\n${detail.slice(-500)}` : '';
    return {
      error: usageError(
        `Error: npm ci failed in ${toolDir}. Confirm Node 20 or newer, then that package-lock.json is present and matches package.json, which is what npm ci requires and will not resolve around. Delete node_modules there and run the same command with --install again. A lockfile that is missing or out of step with the manifest is a defect in this copy of the plugin, not something a re-run fixes.${tail}`
      )
    };
  }
  if (!existsSync(packageMarker(toolDir))) {
    return {
      error: usageError(
        `Error: npm ci finished but ${packageMarker(toolDir)} is still missing. Check that package.json lists @invaro/opentax.`
      )
    };
  }
  return { note: `First run: installing dependencies in ${toolDir}\n` };
}

function inspectEngine(toolDir, pin) {
  const marker = packageMarker(toolDir);
  const bundle = bundleFile(toolDir);
  if (!existsSync(marker)) {
    return {
      engine: 'absent',
      bundleMatchesPin: null,
      packageVersionMatchesPin: null,
      bundlePath: null,
      installedVersion: null,
      bundleHash: null
    };
  }
  let installedVersion = null;
  let versionMatches = false;
  try {
    const pkg = JSON.parse(readFileSync(marker, 'utf8'));
    installedVersion = typeof pkg.version === 'string' ? pkg.version : null;
    versionMatches = installedVersion === pin.packageVersion;
  } catch {
    versionMatches = false;
  }
  if (!existsSync(bundle)) {
    return {
      engine: 'incomplete',
      bundleMatchesPin: null,
      packageVersionMatchesPin: versionMatches,
      bundlePath: null,
      installedVersion,
      bundleHash: null
    };
  }
  let bundleHash = null;
  let hashMatches = false;
  try {
    bundleHash = sha256File(bundle);
    hashMatches = bundleHash === pin.bundleSha256;
  } catch {
    hashMatches = false;
  }
  return {
    engine: versionMatches && hashMatches ? 'complete' : 'incomplete',
    bundleMatchesPin: hashMatches,
    packageVersionMatchesPin: versionMatches,
    bundlePath: bundle,
    installedVersion,
    bundleHash
  };
}

function checkBody(inspection, pin) {
  return {
    command: 'check',
    engine: inspection.engine,
    bundleMatchesPin: inspection.bundleMatchesPin,
    packageVersionMatchesPin: inspection.packageVersionMatchesPin,
    pin: {
      packageName: pin.packageName,
      packageVersion: pin.packageVersion,
      bundleSha256: pin.bundleSha256,
      corpusName: pin.corpusName,
      corpusVersion: pin.corpusVersion,
      corpusMerkleRoot: pin.corpusMerkleRoot,
      nodeRecorded: pin.nodeRecorded
    }
  };
}

function canonicalise(spelling) {
  const missing = [];
  let current = spelling;
  for (;;) {
    try {
      const found = realpathSync(current);
      return missing.reduceRight((acc, part) => join(acc, part), found);
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      missing.push(basename(current));
      current = parent;
    }
  }
}

function screenFacts(spelling) {
  if (typeof spelling !== 'string' || spelling.length === 0 || !isAbsolute(spelling)) {
    return {
      error: usageError(`Error: --facts must be an absolute path; got "${spelling}". Run "${HELP_CMD}" for usage.`)
    };
  }
  const resolved = canonicalise(spelling);
  if (!resolved) {
    return {
      error: usageError(`Error: --facts names "${spelling}", which cannot be read. Pass the absolute path of a readable JSON file.`)
    };
  }
  let info;
  try {
    info = statSync(resolved);
  } catch {
    return {
      error: usageError(`Error: --facts names "${spelling}", which cannot be read. Pass the absolute path of a readable JSON file.`)
    };
  }
  if (!info.isFile()) {
    return {
      error: usageError(`Error: --facts names "${spelling}", which cannot be read. Pass the absolute path of a readable JSON file.`)
    };
  }
  try {
    accessSync(resolved, constants.R_OK);
  } catch {
    return {
      error: usageError(`Error: --facts names "${spelling}", which cannot be read. Pass the absolute path of a readable JSON file.`)
    };
  }
  return { path: resolved };
}

function duplicateError(keyPath) {
  const error = new Error(`duplicate ${keyPath}`);
  error.duplicate = keyPath;
  return error;
}

function parseError(message) {
  const error = new Error(message);
  error.badJson = true;
  return error;
}

export function parseJson(text) {
  let index = 0;
  const source = text;
  function skip() {
    while (index < source.length) {
      const ch = source[index];
      if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') return;
      index += 1;
    }
  }
  function parseValue(path) {
    skip();
    if (index >= source.length) throw parseError('ended');
    const ch = source[index];
    if (ch === '{') return parseObject(path);
    if (ch === '[') return parseArray(path);
    if (ch === '"') return parseString();
    if (ch === 't') return parseLiteral('true', true);
    if (ch === 'f') return parseLiteral('false', false);
    if (ch === 'n') return parseLiteral('null', null);
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
    throw parseError('value');
  }
  function parseObject(path) {
    index += 1;
    const obj = Object.create(null);
    const seen = new Set();
    skip();
    if (source[index] === '}') {
      index += 1;
      return obj;
    }
    for (;;) {
      skip();
      if (source[index] !== '"') throw parseError('key');
      const key = parseString();
      const keyPath = path ? `${path}.${key}` : key;
      if (seen.has(key)) throw duplicateError(keyPath);
      seen.add(key);
      skip();
      if (source[index] !== ':') throw parseError('colon');
      index += 1;
      obj[key] = parseValue(keyPath);
      skip();
      if (source[index] === ',') {
        index += 1;
        continue;
      }
      if (source[index] === '}') {
        index += 1;
        return obj;
      }
      throw parseError('object');
    }
  }
  function parseArray(path) {
    index += 1;
    const arr = [];
    skip();
    if (source[index] === ']') {
      index += 1;
      return arr;
    }
    for (;;) {
      arr.push(parseValue(`${path}[${arr.length}]`));
      skip();
      if (source[index] === ',') {
        index += 1;
        continue;
      }
      if (source[index] === ']') {
        index += 1;
        return arr;
      }
      throw parseError('array');
    }
  }
  function parseString() {
    index += 1;
    let out = '';
    while (index < source.length) {
      const ch = source[index];
      if (ch === '"') {
        index += 1;
        return out;
      }
      if (ch === '\\') {
        index += 1;
        const esc = source[index];
        const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (Object.prototype.hasOwnProperty.call(map, esc)) {
          out += map[esc];
          index += 1;
          continue;
        }
        if (esc === 'u') {
          const hex = source.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw parseError('hex');
          out += String.fromCharCode(Number.parseInt(hex, 16));
          index += 5;
          continue;
        }
        throw parseError('escape');
      }
      if (ch < ' ') throw parseError('control');
      out += ch;
      index += 1;
    }
    throw parseError('string');
  }
  function parseLiteral(word, value) {
    if (source.slice(index, index + word.length) !== word) throw parseError('literal');
    index += word.length;
    return value;
  }
  function parseNumber() {
    const start = index;
    if (source[index] === '-') index += 1;
    if (source[index] === '0') index += 1;
    else if (source[index] >= '1' && source[index] <= '9') {
      while (source[index] >= '0' && source[index] <= '9') index += 1;
    } else throw parseError('number');
    if (source[index] === '.') {
      index += 1;
      if (!(source[index] >= '0' && source[index] <= '9')) throw parseError('fraction');
      while (source[index] >= '0' && source[index] <= '9') index += 1;
    }
    if (source[index] === 'e' || source[index] === 'E') {
      index += 1;
      if (source[index] === '+' || source[index] === '-') index += 1;
      if (!(source[index] >= '0' && source[index] <= '9')) throw parseError('exponent');
      while (source[index] >= '0' && source[index] <= '9') index += 1;
    }
    return new JsonNumber(source.slice(start, index));
  }
  const value = parseValue('');
  skip();
  if (index !== source.length) throw parseError('trailing');
  return value;
}

function readFacts(filePath, pin) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return {
      error: usageError(`Error: --facts names a file that cannot be read. Pass the absolute path of a readable JSON file. Run "${HELP_CMD}" for usage.`)
    };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length > 1000000) {
    return {
      error: refusal(pin, 'FACTS_UNREADABLE', 'facts', 'The facts file is too large. Fix: pass one JSON object of the facts help names.')
    };
  }
  try {
    const value = parseJson(text);
    if (!isPlainObject(value)) {
      return {
        error: refusal(
          pin,
          'FACTS_UNREADABLE',
          'facts',
          `The facts file must be one JSON object. Fix: pass one object. Run "${HELP_CMD}" for the fact vocabulary.`
        )
      };
    }
    return { facts: value };
  } catch (error) {
    if (error && error.duplicate) {
      return {
        error: refusal(
          pin,
          'DUPLICATE_KEY',
          error.duplicate,
          `The facts file repeats ${error.duplicate}. Fix: state that key once. A repeated key would drop a value, so this tool returns no figure.`
        )
      };
    }
    return {
      error: refusal(
        pin,
        'FACTS_UNREADABLE',
        'facts',
        `The facts file is not JSON. Fix: pass one JSON object. Run "${HELP_CMD}" for the fact vocabulary.`
      )
    };
  }
}

function isColorado(value) {
  if (typeof value !== 'string') return false;
  const norm = value.trim().toLowerCase();
  return norm === 'co' || norm === 'colorado';
}

function shown(value) {
  let text;
  if (value instanceof JsonNumber) text = value.lexeme;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (text.length > 80) return `${text.slice(0, 77)}...`;
  return text;
}

function unknownKeys(facts) {
  const unknown = [];
  const top = new Set(['operation', 'jurisdiction', 'taxYear', 'filingStatus', 'profile', 'income']);
  if (facts.operation === 'estimate') top.add('estimate');
  if (facts.filingStatus === 'mfs') top.add('spouseItemizes');
  for (const key of Object.keys(facts)) {
    if (!top.has(key)) unknown.push(key);
  }
  if (isPlainObject(facts.profile)) {
    const allowed = new Set(PROFILE_FIELDS);
    for (const key of Object.keys(facts.profile)) {
      if (!allowed.has(key)) unknown.push(`profile.${key}`);
    }
  }
  if (isPlainObject(facts.income)) {
    const allowed = new Set(INCOME_FIELDS);
    for (const key of Object.keys(facts.income)) {
      if (!allowed.has(key)) unknown.push(`income.${key}`);
    }
  }
  if (facts.operation === 'estimate' && isPlainObject(facts.estimate)) {
    const allowed = new Set(ESTIMATE_FIELDS);
    for (const key of Object.keys(facts.estimate)) {
      if (!allowed.has(key)) unknown.push(`estimate.${key}`);
    }
  }
  return unknown;
}

function missingFacts(facts) {
  const missing = [];
  for (const key of ['operation', 'jurisdiction', 'taxYear', 'filingStatus']) {
    if (!Object.hasOwn(facts, key)) missing.push(key);
  }
  if (facts.filingStatus === 'mfs' && !Object.hasOwn(facts, 'spouseItemizes')) {
    missing.push('spouseItemizes');
  }
  if (!Object.hasOwn(facts, 'profile')) {
    for (const key of PROFILE_FIELDS) missing.push(`profile.${key}`);
  } else if (isPlainObject(facts.profile)) {
    for (const key of PROFILE_FIELDS) {
      if (!Object.hasOwn(facts.profile, key)) missing.push(`profile.${key}`);
    }
  }
  if (!Object.hasOwn(facts, 'income')) {
    for (const key of INCOME_FIELDS) missing.push(`income.${key}`);
  } else if (isPlainObject(facts.income)) {
    for (const key of INCOME_FIELDS) {
      if (!Object.hasOwn(facts.income, key)) missing.push(`income.${key}`);
    }
  }
  if (facts.operation === 'estimate') {
    if (!Object.hasOwn(facts, 'estimate') || !isPlainObject(facts.estimate)) {
      if (!Object.hasOwn(facts, 'estimate')) {
        for (const key of ESTIMATE_FIELDS) missing.push(`estimate.${key}`);
      }
    } else {
      for (const key of ESTIMATE_FIELDS) {
        if (!Object.hasOwn(facts.estimate, key)) missing.push(`estimate.${key}`);
      }
    }
  }
  return missing;
}

function invalidValue(pin, path, expectation, value) {
  return refusal(
    pin,
    'INVALID_VALUE',
    path,
    `${path} must be ${expectation}; got ${shown(value)}. Fix: pass a value that help allows.`
  );
}

function amountOk(value) {
  return value instanceof JsonNumber && /^\d+(?:\.\d{1,2})?$/.test(value.lexeme);
}

function featureRefusal(pin, operation) {
  if (ANNUALIZED.has(operation)) {
    return refusal(
      pin,
      'FEATURE_UNSUPPORTED',
      operation,
      `The operation ${operation} is refused by name. The annualized installment method is not computed by this tool. Fix: pass operation estimate for the regular installment method, or liability for the federal total tax, Form 1040 line 24, less refundable credits.`
    );
  }
  if (operation.includes('.')) {
    return refusal(
      pin,
      'FEATURE_UNSUPPORTED',
      operation,
      `The operation ${operation} is refused by name. It is not computed by this tool. Fix: pass operation liability or estimate.`
    );
  }
  return refusal(
    pin,
    'FEATURE_UNSUPPORTED',
    operation,
    `The operation ${operation} is not supported. Fix: pass operation liability or estimate.`
  );
}

function dollarsToCents(value) {
  const lexeme = value instanceof JsonNumber ? value.lexeme : '';
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(lexeme);
  if (!match) throw new Error('cents');
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

function centsToDecimal(cents) {
  const whole = cents / 100n;
  const frac = cents % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

function gateFacts(facts, pin) {
  // An operation outside the two supported is named before any other key is.
  if (typeof facts.operation === 'string' && facts.operation !== 'liability' && facts.operation !== 'estimate') {
    return featureRefusal(pin, facts.operation);
  }
  if (isColorado(facts.jurisdiction)) {
    return refusal(
      pin,
      'COLORADO',
      facts.jurisdiction,
      'Nothing this tool runs computes Colorado. Fix: pass jurisdiction federal. This tool computes a federal figure only.'
    );
  }
  const unknown = unknownKeys(facts);
  if (unknown.length) {
    const onlyEstimate = unknown.length === 1 && unknown[0] === 'estimate' && facts.operation === 'liability';
    const message = onlyEstimate
      ? `The key estimate is refused when operation is liability. Fix: remove estimate, or pass operation estimate. Run "${HELP_CMD}" for the fact vocabulary.`
      : `The facts contain ${unknown.join(', ')}, which this tool does not accept. Fix: remove them. Run "${HELP_CMD}" for the fact vocabulary.`;
    return refusal(pin, 'UNKNOWN_KEY', unknown.length === 1 ? unknown[0] : unknown, message);
  }
  const missing = missingFacts(facts);
  if (missing.length) {
    return refusal(
      pin,
      'FACTS_MISSING',
      missing.length === 1 ? missing[0] : missing,
      `The facts omit ${missing.join(', ')}. Fix: state each one. Zero is a value you state, not a default.`
    );
  }
  if (typeof facts.operation !== 'string') {
    return invalidValue(pin, 'operation', 'the string liability or estimate', facts.operation);
  }
  if (typeof facts.jurisdiction !== 'string') {
    return invalidValue(pin, 'jurisdiction', 'the string federal', facts.jurisdiction);
  }
  if (!(facts.taxYear instanceof JsonNumber) || !/^\d+$/.test(facts.taxYear.lexeme)) {
    return invalidValue(pin, 'taxYear', 'the digits 2025 or 2026', facts.taxYear);
  }
  if (typeof facts.filingStatus !== 'string' || !FILING.has(facts.filingStatus)) {
    return invalidValue(pin, 'filingStatus', 'one of single, mfj, mfs, hoh, qss', facts.filingStatus);
  }
  if (!isPlainObject(facts.profile)) {
    return invalidValue(pin, 'profile', 'an object of six booleans, each false', facts.profile);
  }
  for (const key of PROFILE_FIELDS) {
    if (typeof facts.profile[key] !== 'boolean') {
      return invalidValue(pin, `profile.${key}`, 'a boolean, false for a supported profile', facts.profile[key]);
    }
  }
  const unsupportedProfile = PROFILE_FIELDS.filter((key) => facts.profile[key] === true);
  if (unsupportedProfile.length) {
    const names = unsupportedProfile.map((key) => `profile.${key}`);
    return refusal(
      pin,
      'FEATURE_UNSUPPORTED',
      names.length === 1 ? names[0] : names,
      `${names.join(', ')} is outside the profile this tool computes. A figure is computed only when each profile boolean is false. Fix: pass false only when that statement is true. Run "${HELP_CMD}" for what each one means.`
    );
  }
  if (!isPlainObject(facts.income)) {
    return invalidValue(pin, 'income', 'an object of the seven income amounts', facts.income);
  }
  for (const key of INCOME_FIELDS) {
    if (!amountOk(facts.income[key])) {
      return invalidValue(pin, `income.${key}`, 'digits, with an optional decimal point and one or two digits after it', facts.income[key]);
    }
  }
  if (dollarsToCents(facts.income.qualifiedDividends) > dollarsToCents(facts.income.ordinaryDividends)) {
    return refusal(
      pin,
      'INVALID_VALUE',
      ['income.ordinaryDividends', 'income.qualifiedDividends'],
      `income.qualifiedDividends (${shown(facts.income.qualifiedDividends)}) is greater than income.ordinaryDividends (${shown(facts.income.ordinaryDividends)}). Ordinary dividends are Form 1099-DIV box 1a, the total including qualified dividends, and qualified dividends are box 1b, which cannot exceed box 1a. Fix: pass box 1a as income.ordinaryDividends and box 1b as income.qualifiedDividends.`
    );
  }
  if (facts.jurisdiction !== 'federal') {
    return refusal(
      pin,
      'JURISDICTION_UNSUPPORTED',
      facts.jurisdiction,
      `Jurisdiction ${shown(facts.jurisdiction)} is not supported. Fix: pass jurisdiction federal. This tool computes a federal figure only.`
    );
  }
  if (facts.taxYear.lexeme !== '2025' && facts.taxYear.lexeme !== '2026') {
    const yearText = facts.taxYear.lexeme;
    const yearSubject = /^\d{1,15}$/.test(yearText) ? Number(yearText) : yearText;
    return refusal(
      pin,
      'YEAR_UNSUPPORTED',
      yearSubject,
      `Tax year ${yearText} is not supported. Fix: pass taxYear 2025 or 2026.`
    );
  }
  facts.taxYear = facts.taxYear.lexeme === '2026' ? 2026 : 2025;
  if (facts.filingStatus === 'mfs') {
    if (typeof facts.spouseItemizes !== 'boolean') {
      return invalidValue(pin, 'spouseItemizes', 'a boolean, true or false', facts.spouseItemizes);
    }
    if (facts.spouseItemizes === true) {
      return refusal(
        pin,
        'FEATURE_UNSUPPORTED',
        'spouseItemizes',
        'A spouse who itemizes deductions is outside the list this tool supports. This tool collects no itemized deductions, and the engine would treat them as zero. Fix: pass spouseItemizes false only when the spouse does not itemize on a separate return.'
      );
    }
  }
  if (facts.operation === 'estimate') {
    if (!isPlainObject(facts.estimate)) {
      return invalidValue(pin, 'estimate', 'an object of the six estimate facts', facts.estimate);
    }
    for (const key of AMOUNT_FIELDS) {
      if (!amountOk(facts.estimate[key])) {
        return invalidValue(pin, `estimate.${key}`, 'digits, with an optional decimal point and one or two digits after it', facts.estimate[key]);
      }
    }
    for (const key of BOOLEAN_FIELDS) {
      if (typeof facts.estimate[key] !== 'boolean') {
        return invalidValue(pin, `estimate.${key}`, 'a boolean, true or false', facts.estimate[key]);
      }
    }
    if (facts.estimate.farmerOrFisherman === true) {
      return refusal(
        pin,
        'FEATURE_UNSUPPORTED',
        'estimate.farmerOrFisherman',
        'A farmer or fisherman is outside the list this tool supports. Fix: pass estimate.farmerOrFisherman false. This tool computes only for a filer who is not a farmer or fisherman.'
      );
    }
    const ineligible = [];
    if (facts.estimate.priorYearReturnFiled === false) ineligible.push('estimate.priorYearReturnFiled');
    if (facts.estimate.priorYearTwelveMonths === false) ineligible.push('estimate.priorYearTwelveMonths');
    if (ineligible.length) {
      return refusal(
        pin,
        'PRIOR_YEAR_INELIGIBLE',
        ineligible.length === 1 ? ineligible[0] : ineligible,
        `The prior-year safe harbour cannot be applied because ${ineligible.join(' and ')} is false. The engine applies the prior-year prong without testing that a return was filed for the preceding taxable year and that the year was 12 months (26 U.S.C. 6654(d)(1)(B), closing sentence). Fix: pass true for both only when both are true; otherwise this tool returns no estimate.`
      );
    }
  }
  return null;
}

function engineIncome(income) {
  const cents = Object.create(null);
  for (const key of INCOME_FIELDS) cents[key] = dollarsToCents(income[key]);
  // Box 1a includes box 1b. The engine's ordinaryDividends is the non-qualified remainder.
  cents.ordinaryDividends -= cents.qualifiedDividends;
  const out = Object.create(null);
  for (const key of INCOME_FIELDS) out[key] = centsToDecimal(cents[key]);
  return out;
}

function enginePayload(facts, target) {
  const filing = { filingStatus: facts.filingStatus };
  if (facts.filingStatus === 'mfs') filing.spouseItemizes = facts.spouseItemizes;
  const payload = {
    target,
    asOf: `${facts.taxYear}-12-31`,
    filing,
    income: engineIncome(facts.income)
  };
  if (facts.operation === 'estimate') {
    payload.payments_estimates = {
      federalTaxWithheld: centsToDecimal(dollarsToCents(facts.estimate.federalTaxWithheld)),
      priorYearTax: centsToDecimal(dollarsToCents(facts.estimate.priorYearTax)),
      priorYearAGI: centsToDecimal(dollarsToCents(facts.estimate.priorYearAGI)),
      isFarmerOrFisherman: facts.estimate.farmerOrFisherman
    };
  }
  return payload;
}

function schemaNames(issues) {
  const names = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const path = Array.isArray(issue.path) ? issue.path.map(String).join('.') : '';
    const keys = Array.isArray(issue.keys) ? issue.keys.map(String) : [];
    if (keys.length) {
      for (const key of keys) names.push(path ? `${path}.${key}` : key);
      continue;
    }
    if (path) names.push(path);
    else if (typeof issue.message === 'string') names.push(issue.message);
  }
  return names;
}

function schemaRefusal(pin, names, detail) {
  const subject = names.length === 1 ? names[0] : (names.length ? names : '-32602');
  const named = names.length ? names.join(', ') : 'the value it rejected';
  return refusal(
    pin,
    'SCHEMA_REJECTED',
    subject,
    `The engine rejected the request (${named}). ${detail} Fix: remove or correct the named key. Run "${HELP_CMD}" for the fact vocabulary.`
  );
}

function neededEngineFacts(facts) {
  const names = facts.operation === 'estimate' ? ESTIMATE_ENGINE_FACTS : LIABILITY_ENGINE_FACTS;
  if (facts.filingStatus === 'mfs') return [...names, 'spouseItemizes'];
  return names;
}

function defaultedNeeded(assumptions, facts) {
  if (!Array.isArray(assumptions)) return { unreadable: true, found: [] };
  const needed = new Set(neededEngineFacts(facts));
  const found = [];
  for (const entry of assumptions) {
    if (!entry || typeof entry !== 'object') continue;
    const fact = typeof entry.factId === 'string' ? entry.factId : entry.fact;
    if (entry.source === 'default' && needed.has(fact) && !found.includes(fact)) found.push(fact);
  }
  return { unreadable: false, found };
}

function listedDefaults(assumptions) {
  const listed = [];
  for (const entry of assumptions) {
    if (!entry || typeof entry !== 'object' || entry.source !== 'default') continue;
    const fact = typeof entry.factId === 'string' ? entry.factId : entry.fact;
    if (typeof fact !== 'string') continue;
    listed.push({ fact, value: entry.value, rationale: entry.rationale });
  }
  return listed;
}

function formatCents(cents) {
  const padded = cents.padStart(3, '0');
  const frac = padded.slice(-2);
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${whole}.${frac}`;
}

function identityMismatch(parsed, expected) {
  const target = typeof parsed.target === 'string' ? parsed.target : '';
  const asOf = typeof parsed.asOf === 'string' ? parsed.asOf : '';
  if (target === expected.target && asOf === expected.asOf) return null;
  return fault(
    'RESULT_MISMATCH',
    `The engine returned target ${shown(parsed.target)} as of ${shown(parsed.asOf)}, which differs from the request ${expected.target} as of ${expected.asOf}, so no figure is returned. Fix: confirm the installed engine is @invaro/opentax 0.4.0 and run the command again.`
  );
}

// The engine's own us.federal.estimated.safe_harbor_met is a boolean target, and
// calculate_tax answers it as valueCents "0" on both arms, so it carries no
// determination. 26 U.S.C. § 6654(e)(1) is applied here to the engine's own
// balance_due and required_annual_payment, which are money and do round-trip.
function determinationOf(balanceParsed, requiredParsed, withheldCents) {
  let balance;
  let required;
  try {
    balance = BigInt(balanceParsed.valueCents);
    required = BigInt(requiredParsed.valueCents);
  } catch {
    return null;
  }
  return balance < SAFE_HARBOR_BALANCE_CENTS || withheldCents >= required;
}

function interpretMessage(message, pin, facts, expected) {
  if (!message || typeof message !== 'object') return fault('ENGINE_UNREADABLE', UNREADABLE);
  if (message.error) {
    if (message.error.code === -32602) {
      const data = message.error.data;
      let names = [];
      if (Array.isArray(data)) names = schemaNames(data);
      else if (data && typeof data === 'object') names = schemaNames([data]);
      const detail = typeof message.error.message === 'string' ? message.error.message : 'JSON-RPC error -32602.';
      return schemaRefusal(pin, names, detail);
    }
    return fault('ENGINE_UNREADABLE', UNREADABLE);
  }
  const content = message.result && message.result.content;
  let text = null;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && part.type === 'text' && typeof part.text === 'string') text = part.text;
    }
  }
  if (typeof text !== 'string') return fault('ENGINE_UNREADABLE', UNREADABLE);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (text.includes('-32602')) {
      let names = [];
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start >= 0 && end > start) {
        try {
          const issues = JSON.parse(text.slice(start, end + 1));
          if (Array.isArray(issues)) names = schemaNames(issues);
        } catch {
          names = [];
        }
      }
      return schemaRefusal(pin, names, 'JSON-RPC error -32602.');
    }
    return fault('ENGINE_UNREADABLE', UNREADABLE);
  }
  if (!parsed || typeof parsed !== 'object') return fault('ENGINE_UNREADABLE', UNREADABLE);
  if (parsed.ok === false && parsed.error && parsed.error.code === 'NEEDS_FACTS') {
    const raw = parsed.error.data && parsed.error.data.missing;
    const missing = Array.isArray(raw)
      ? raw.map((item) => item && (item.factId || item.fact)).filter((item) => typeof item === 'string')
      : [];
    return refusal(
      pin,
      'NEEDS_FACTS',
      missing.length === 1 ? missing[0] : (missing.length ? missing : 'NEEDS_FACTS'),
      `The engine refused to compute because it needs ${missing.length ? missing.join(', ') : 'a fact it did not name'}. Fix: state each of those facts. Zero is a value you state, not a default.`
    );
  }
  if (parsed.ok === false && parsed.error && parsed.error.code === 'NO_APPLICABLE_RULE') {
    const asOf = parsed.error.data && parsed.error.data.asOf;
    const subject = typeof asOf === 'string' ? asOf : 'taxYear';
    const detail = typeof parsed.error.message === 'string' ? parsed.error.message : 'no applicable rule';
    return refusal(
      pin,
      'NO_APPLICABLE_RULE',
      subject,
      `The engine has no applicable rule (${detail}). Fix: pass taxYear 2025 or 2026.`
    );
  }
  if (parsed.ok === false) {
    const code = parsed.error && parsed.error.code ? String(parsed.error.code) : 'error';
    return refusal(
      pin,
      'ENGINE_REFUSED',
      code,
      `The engine refused to compute (${code}). Fix: change the facts to a supported liability or estimate and run the command again.`
    );
  }
  if (parsed.ok !== true) return fault('ENGINE_UNREADABLE', UNREADABLE);
  if (expected) {
    const mismatch = identityMismatch(parsed, expected);
    if (mismatch) return mismatch;
  }
  const defaults = defaultedNeeded(parsed.assumptions, facts);
  if (defaults.unreadable) return fault('ENGINE_UNREADABLE', UNREADABLE);
  if (defaults.found.length) {
    return refusal(
      pin,
      'FACTS_DEFAULTED',
      defaults.found.length === 1 ? defaults.found[0] : defaults.found,
      `The engine defaulted ${defaults.found.join(', ')}, which this operation needs stated, so no figure is returned. Fix: state each of those facts. If they are already stated, this tool will not pass on a figure the engine treated as a default.`
    );
  }
  if (typeof parsed.corpusMerkleRoot !== 'string' || parsed.corpusMerkleRoot !== pin.corpusMerkleRoot) {
    return refusal(
      pin,
      'PIN_ROOT',
      'corpusMerkleRoot',
      'The engine corpus root did not match the pinned root, so no figure is returned. Fix: delete node_modules in the tool directory and run the same command with --install so the pinned engine is the one that runs.'
    );
  }
  const signed = Boolean(expected && expected.signed);
  if (!signed && typeof parsed.valueCents === 'string' && /^-\d{1,200}$/.test(parsed.valueCents)) {
    return refusal(
      pin,
      'NEGATIVE_FIGURE',
      'valueCents',
      'The engine returned a negative figure, meaning refundable credits exceed the tax. This tool collects none of the facts a refundable credit rests on, so such a figure would rest on the engine\'s defaults, and no figure is returned. Fix: compute this return with a full preparation tool or a licensed professional.'
    );
  }
  const centsPattern = signed ? /^-?\d{1,200}$/ : /^\d{1,200}$/;
  if (typeof parsed.valueCents !== 'string' || !centsPattern.test(parsed.valueCents)) {
    return fault('ENGINE_UNREADABLE', UNREADABLE);
  }
  if (typeof parsed.artifactHash !== 'string' || parsed.artifactHash.length === 0 || parsed.artifactHash.length > 200) {
    return fault('ENGINE_UNREADABLE', UNREADABLE);
  }
  return { parsed };
}

function successBody({ facts, parsed, pin, bundleHash, estimate }) {
  const met = Boolean(estimate && estimate.determination === true);
  const figureCents = met ? '0' : parsed.valueCents;
  const body = {
    operation: facts.operation,
    jurisdiction: facts.jurisdiction,
    taxYear: facts.taxYear,
    filingStatus: facts.filingStatus,
    figure: {
      valueCents: figureCents,
      dollars: formatCents(figureCents),
      label: facts.operation === 'estimate' ? (met ? SAFE_HARBOR_LABEL : ESTIMATE_LABEL) : LIABILITY_LABEL
    },
    assumptions: listedDefaults(parsed.assumptions),
    provenance: {
      packageName: pin.packageName,
      packageVersion: pin.packageVersion,
      corpusName: pin.corpusName,
      corpusVersion: pin.corpusVersion,
      corpusRoot: parsed.corpusMerkleRoot,
      artifactHash: parsed.artifactHash,
      bundleHash,
      node: process.version,
      nodeRecorded: pin.nodeRecorded
    },
    statement: STATEMENT
  };
  if (facts.operation === 'estimate') {
    body.estimateDetail = {
      fourRequiredInstallments: !met,
      regularInstallmentMethod: true,
      withholdingTreatedAsPaidEvenly: true,
      annualizedInstallmentMethodComputed: false,
      determination: estimate.determination,
      regularMethodInstallment: {
        valueCents: estimate.installment.valueCents,
        dollars: formatCents(estimate.installment.valueCents)
      },
      statement: met ? SAFE_HARBOR_STATEMENT : ESTIMATE_STATEMENT
    };
  }
  return body;
}

function pinGate(inspection, pin) {
  if (!inspection.bundlePath) {
    return fault(
      'ENGINE_INCOMPLETE',
      'The engine in this tool directory is incomplete: bundle/index.js is not installed, so nothing was computed. Fix: delete node_modules in the tool directory and run the same command with --install.'
    );
  }
  if (!inspection.packageVersionMatchesPin) {
    const found = inspection.installedVersion
      ? `The installed package version is ${inspection.installedVersion}.`
      : 'The installed package.json has no readable version.';
    return refusal(
      pin,
      'PIN_VERSION',
      'packageVersion',
      `${found} This tool runs only ${pin.packageName} ${pin.packageVersion}. Fix: delete node_modules in the tool directory and run the same command with --install.`
    );
  }
  if (!inspection.bundleMatchesPin) {
    return refusal(
      pin,
      'PIN_BUNDLE',
      'bundle/index.js',
      'The installed bundle/index.js does not match the pinned hash, so nothing was computed. Fix: delete node_modules in the tool directory and run the same command with --install.'
    );
  }
  return null;
}

function callEngine({ enginePath, payloads, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [enginePath], {
      env: {
        OPENTAX_TELEMETRY: '0',
        DO_NOT_TRACK: '1'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let settled = false;
    let buf = '';
    const pending = new Map();
    let nextId = 1;
    const timer = setTimeout(() => {
      settle(fault(
        'ENGINE_TIMEOUT',
        `The engine did not answer within ${timeoutMs} ms and was stopped. Fix: run the command again. If it keeps failing, delete node_modules in the tool directory and run the same command with --install.`
      ), true);
    }, timeoutMs);

    function settle(result, force) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const done of pending.values()) done({ abandoned: true });
      pending.clear();
      resolve(result);
      if (child.exitCode === null && child.signalCode === null) {
        try {
          if (force) child.kill('SIGKILL');
          else child.stdin.end();
        } catch {
          /* already closed */
        }
        if (!force) {
          const killer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* gone */ }
          }, 500);
          child.once('exit', () => clearTimeout(killer));
        }
      }
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    child.stderr.on('data', () => {});
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          if (pending.size) {
            settle(fault('ENGINE_UNREADABLE', UNREADABLE), true);
          }
          return;
        }
        if (msg && Object.prototype.hasOwnProperty.call(msg, 'id') && pending.has(msg.id)) {
          const done = pending.get(msg.id);
          pending.delete(msg.id);
          done(msg);
        }
      }
    });
    child.on('error', () => {
      settle(fault(
        'ENGINE_CRASH',
        'The engine could not be started. Fix: confirm Node 20 or newer and that the installed bundle is present, then run the command again.'
      ), true);
    });
    child.on('exit', (code) => {
      if (settled || pending.size === 0) return;
      settle(fault(
        'ENGINE_CRASH',
        `The engine exited before it answered (exit ${code}). Fix: delete node_modules in the tool directory and run the same command with --install.`
      ), true);
    });

    function request(method, params) {
      const id = nextId;
      nextId += 1;
      return new Promise((done) => {
        pending.set(id, done);
        const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
        try {
          child.stdin.write(line);
        } catch {
          if (!settled) {
            settle(fault(
              'ENGINE_CRASH',
              'The engine stopped while the request was being sent. Fix: run the command again.'
            ), true);
          }
        }
      });
    }

    function notify(method, params) {
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
      } catch {
        /* exit or error handler settles */
      }
    }

    (async () => {
      try {
        const init = await request('initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'tax-engine', version: '0.1.0' }
        });
        if (settled || init.abandoned) return;
        if (init.error) {
          settle(fault('ENGINE_UNREADABLE', UNREADABLE), false);
          return;
        }
        notify('notifications/initialized', {});
        const responses = [];
        for (const payload of payloads) {
          const response = await request('tools/call', {
            name: 'calculate_tax',
            arguments: payload
          });
          if (settled || response.abandoned) return;
          responses.push(response);
        }
        settle({ responses }, false);
      } catch {
        if (!settled) {
          settle(fault(
            'ENGINE_CRASH',
            'The engine stopped while the request was being sent. Fix: run the command again.'
          ), true);
        }
      }
    })();
  });
}

function withInstallNote(result, note) {
  if (result.exitCode === 0 && note) return { ...result, stderr: note + result.stderr };
  return result;
}

function parseFlags(args, valueFlags, bareFlags) {
  const values = {};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (valueFlags.has(token)) {
      const next = args[index + 1];
      if (next === undefined) {
        return { error: usageError(`Error: ${token} needs a value. Run "${HELP_CMD}" for usage.`) };
      }
      if (seen.has(token)) {
        return { error: usageError(`Error: ${token} was given more than once and takes one value. Run "${HELP_CMD}" for usage.`) };
      }
      seen.add(token);
      values[token] = next;
      index += 1;
      continue;
    }
    if (bareFlags.has(token)) {
      values[token] = true;
      continue;
    }
    if (token.startsWith('-')) {
      return { error: usageError(`Error: unknown option "${token}". Run "${HELP_CMD}" for usage.`) };
    }
    return { error: usageError(`Error: unexpected argument "${token}". Run "${HELP_CMD}" for usage.`) };
  }
  return { values };
}

function resolvePin(toolDir, options) {
  if (options.pin !== undefined) return validPin(options.pin) ? options.pin : null;
  return loadPin(toolDir);
}

/**
 * @param {readonly string[]} argv
 * @param {object} [options]
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export async function main(argv, options = {}) {
  const args = Array.isArray(argv) ? argv : [];
  if (args[0] === 'help' || args[0] === '--help') {
    const bad = args.slice(1).find((token) => token !== 'help' && token !== '--help');
    if (!bad) return helpResult();
    if (String(bad).startsWith('-')) {
      return usageError(`Error: unknown option "${bad}". Run "${HELP_CMD}" for usage.`);
    }
    return usageError(`Error: unexpected argument "${bad}". Run "${HELP_CMD}" for usage.`);
  }
  if (args.length === 0) {
    return usageError(`Error: a command is required. Run "${HELP_CMD}" for usage.`);
  }
  if (args[0].startsWith('-')) {
    return usageError(`Error: unknown option "${args[0]}". Run "${HELP_CMD}" for usage.`);
  }
  const command = args[0];
  if (command !== 'compute' && command !== 'check') {
    return usageError(`Error: unknown command "${command}". Run "${HELP_CMD}" for usage.`);
  }

  const toolDir = options.toolDir || DEFAULT_TOOL_DIR;
  const fromFile = options.fromFile || fileURLToPath(import.meta.url);
  const env = options.env || process.env;
  const install = parsedInstallFlag(args, VALUE_FLAGS);
  const runInstall = options.runInstall || defaultRunInstall;

  if (command === 'check') {
    const parsed = parseFlags(args.slice(1), new Set(), new Set(['--install', '--help']));
    if (parsed.error) return parsed.error;
    if (parsed.values['--help']) return helpResult();
    const pin = resolvePin(toolDir, options);
    if (!pin) {
      return fault('PIN_UNREADABLE', 'The pin in this tool directory cannot be read. Fix: restore pin.json in the tool directory and run the command again.');
    }
    // A survey check reports absence. Only a bare --install installs, and a
    // check without that flag never writes the consent marker.
    let note = '';
    if (install) {
      const installed = await ensureInstalled({
        toolDir,
        fromFile,
        install,
        env,
        runInstall,
        allowVariable: false,
        nodeVersion: options.nodeVersion
      });
      if (installed.error) return installed.error;
      note = installed.note;
    }
    const inspection = inspectEngine(toolDir, pin);
    return withInstallNote(jsonOut(0, checkBody(inspection, pin)), note);
  }

  const parsed = parseFlags(args.slice(1), VALUE_FLAGS, new Set(['--install', '--help']));
  if (parsed.error) return parsed.error;
  if (parsed.values['--help']) return helpResult();
  if (!Object.prototype.hasOwnProperty.call(parsed.values, '--facts')) {
    return usageError(`Error: --facts is required. Pass the absolute path of the JSON facts file. Run "${HELP_CMD}" for usage.`);
  }
  const screened = screenFacts(parsed.values['--facts']);
  if (screened.error) return screened.error;
  const pin = resolvePin(toolDir, options);
  if (!pin) {
    return fault('PIN_UNREADABLE', 'The pin in this tool directory cannot be read. Fix: restore pin.json in the tool directory and run the command again.');
  }
  const loaded = readFacts(screened.path, pin);
  if (loaded.error) return loaded.error;
  const gated = gateFacts(loaded.facts, pin);
  if (gated) return gated;

  const installed = await ensureInstalled({
    toolDir,
    fromFile,
    install,
    env,
    runInstall,
    allowVariable: true,
    nodeVersion: options.nodeVersion
  });
  if (installed.error) return installed.error;
  const inspection = inspectEngine(toolDir, pin);
  const pinned = pinGate(inspection, pin);
  if (pinned) return withInstallNote(pinned, installed.note);
  const enginePath = options.enginePath || inspection.bundlePath;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const asOf = `${loaded.facts.taxYear}-12-31`;
  const primaryTarget = loaded.facts.operation === 'estimate' ? QUARTERLY_TARGET : NET_TAX_TARGET;
  const payloads = [enginePayload(loaded.facts, primaryTarget)];
  if (loaded.facts.operation === 'estimate') {
    payloads.push(
      enginePayload(loaded.facts, BALANCE_DUE_TARGET),
      enginePayload(loaded.facts, REQUIRED_ANNUAL_TARGET)
    );
  }
  const called = await callEngine({ enginePath, payloads, timeoutMs });
  if (called.exitCode) return withInstallNote(called, installed.note);
  const primary = interpretMessage(called.responses[0], pin, loaded.facts, {
    target: primaryTarget,
    asOf,
    signed: false
  });
  if (primary.exitCode) return withInstallNote(primary, installed.note);
  let estimate = null;
  if (loaded.facts.operation === 'estimate') {
    const balance = interpretMessage(called.responses[1], pin, loaded.facts, {
      target: BALANCE_DUE_TARGET,
      asOf,
      signed: true
    });
    if (balance.exitCode) return withInstallNote(balance, installed.note);
    const required = interpretMessage(called.responses[2], pin, loaded.facts, {
      target: REQUIRED_ANNUAL_TARGET,
      asOf,
      signed: false
    });
    if (required.exitCode) return withInstallNote(required, installed.note);
    const determination = determinationOf(
      balance.parsed,
      required.parsed,
      dollarsToCents(loaded.facts.estimate.federalTaxWithheld)
    );
    if (determination === null) {
      return withInstallNote(fault('ENGINE_UNREADABLE', UNREADABLE), installed.note);
    }
    estimate = { determination, installment: primary.parsed };
  }
  const body = successBody({
    facts: loaded.facts,
    parsed: primary.parsed,
    pin,
    bundleHash: inspection.bundleHash,
    estimate
  });
  return withInstallNote(jsonOut(0, body), installed.note);
}
