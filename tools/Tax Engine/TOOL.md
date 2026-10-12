---
name: Tax Engine
type: tool
category: tax
description: One JSON object with a federal figure from stated facts, the total tax or one regular quarterly estimate, or a check of the pinned engine
version: 0.1.0
---

# Tax Engine

One federal figure, computed from a facts file, or a check of the pinned engine. The tool computes. It gives no advice, and it produces or fills no form.

## Context

Use it when a skill needs a federal figure for `liability` or for `estimate`.

Do not use it for any tax other than those two operations, for a year other than 2025 or 2026, for any state, or when the jurisdiction is Colorado. Do not use it for advice, or to produce or fill a form.

It is the only path by which this plugin's skills reach a tax figure. A skill states no figure this tool did not return.

The constitution's Standing constraint binds the result. This plugin does not replace a licensed CPA, enrolled agent, or other tax professional, and it does not hold itself out as one. What that yields here: the tool computes a figure and returns it. It gives no advice, and it produces or fills no form.

Classifier seam: none.

## Quick Start

The tool needs Node 20 or later. An install on an older Node stops and names the version it found. Once the package is present, a run records the Node version on a success and does not refuse an older Node.

```bash
node scripts/tax-engine.js help
```

Usage text, with nothing installed. `help` and `--help` do not read the consent marker and do not install.

```bash
node scripts/tax-engine.js check
```

One JSON object on stdout, exit 0. `engine` is `absent`, `complete`, or `incomplete`. A check does not start the engine. A check without `--install` does not install and does not write the consent marker, including when `WISER_ALLOW_INSTALL=1` is set.

```bash
node scripts/tax-engine.js compute --facts /path/to/facts.json
```

The facts file is one JSON object. A first `compute` whose facts pass the gate, in a copy that has not authorised an install, reports what it would fetch and stops, exit 1, before it installs and before it starts the engine. The report names `@invaro/opentax@0.4.0`, `registry.npmjs.org`, this tool's directory, and 5131493 bytes unpacked. Re-run the same command with `--install`, or set `WISER_ALLOW_INSTALL=1` for an unattended run. That run installs, finishes the work, and writes `.wiser-consent` at the plugin root. A later run in a copy whose marker matches does not ask.

```bash
node scripts/tax-engine.js compute --facts /path/to/facts.json --install
```

One JSON object on stdout when the figure is returned. When that run installed, stderr begins with `First run: installing dependencies in` and the tool directory. Anything else, see Troubleshooting.

A minimal `liability` file, with every amount stated and zero where the person has none:

```json
{
  "operation": "liability",
  "jurisdiction": "federal",
  "taxYear": 2025,
  "filingStatus": "single",
  "income": {
    "wages": 0,
    "taxableInterest": 0,
    "ordinaryDividends": 0,
    "qualifiedDividends": 0,
    "shortTermCapitalGains": 0,
    "longTermCapitalGains": 0
  }
}
```

## Usage

Run the commands from this tool's directory.

| Command | Purpose | Starts the engine | Writes |
|---------|---------|-------------------|--------|
| `node scripts/tax-engine.js help` | Print usage and exit | No | No |
| `node scripts/tax-engine.js --help` | Print usage and exit | No | No |
| `node scripts/tax-engine.js check [--install]` | Report the install against the pin | No | The install and the consent marker, only with `--install` when the package is absent |
| `node scripts/tax-engine.js compute --facts <absolute path> [--install]` | Read one JSON facts file and compute one federal figure | Yes, after the gates below pass | `node_modules/` when the package is absent and the run is authorised. `.wiser-consent` when `--install` or `WISER_ALLOW_INSTALL=1` authorises that install. A matching marker that already authorises the install is not rewritten. |

One help text covers every command. `compute --help` and `check --help` print that same text and do no other work. `-h` is an unknown option.

| Option | Commands | Effect |
|--------|----------|--------|
| `--facts <absolute path>` | `compute` | The facts file. Required for `compute`. A relative path is refused by name. The value is the next argument, so `--facts --install` takes `--install` as the path and is not consent. |
| `--install` | `compute`, `check` | Authorise the install and finish the run. On `compute`, `WISER_ALLOW_INSTALL=1` does the same for an unattended run, and so does a `.wiser-consent` marker at the plugin root whose `realpath` equals that root. On `check`, only a bare `--install` installs. A check without `--install` never writes the consent marker. |
| `--help` | `help`, `compute`, `check` | Print usage and exit. |

No command takes `--env`. An unknown option, an unknown command, an unexpected argument, and a repeated `--facts` are refused by name before any install, any read of a facts file, and any start of the engine. The message points at `help`. `--flag=value` is an unknown option; pass the value as the next argument. A flag that needs a value and is given none is refused. `--install` may appear once as a bare flag. A value whose text is `--install` is not consent.

`check` prints one JSON object and exits 0 when it can report. `engine` is `absent` when `node_modules/@invaro/opentax/package.json` is missing, `incomplete` when that file is present and the version or the bundle hash does not match the pin or the bundle file is missing, and `complete` when the installed version and the bundle hash both match. `bundleMatchesPin` and `packageVersionMatchesPin` are `true`, `false`, or `null`. `null` is what a missing package gives both fields, and what a missing bundle gives `bundleMatchesPin`. `pin` holds the seven values The pin lists. Read those fields. Exit 0 means the report was made, including a report that the engine is absent or incomplete.

### Fact vocabulary

The file is one JSON object, UTF-8. A leading byte-order mark is removed. Every key below is required unless a line says otherwise. Any other key, at any level, is refused by name before the engine starts. Zero is a value the person states, not a default this tool fills in. Omitting a required fact is a refusal, not a zero.

| Fact | Definition | Document line |
|------|------------|---------------|
| `operation` | `liability` or `estimate`. `liability` is the federal total tax net of refundable credits: income tax plus self-employment tax, net investment income tax and Additional Medicare Tax, less refundable credits. It is not income tax alone. The engine target is `us.federal.net_tax`. `estimate` is the required quarterly estimated payment by the regular installment method. The engine target is `us.federal.estimated.quarterly_payment`. | Form 1040 lines 22 to 24, for `liability`. The estimate names no form line. |
| `jurisdiction` | The string `federal`, exactly. | None. This tool computes a federal figure only. |
| `taxYear` | The integer `2025` or `2026`. The tool asks the engine for that year's 31 December, as `asOf`. | The date sent is `<taxYear>-12-31`. |
| `filingStatus` | `single`, `mfj`, `mfs`, `hoh`, or `qss`. | None in this tool. The token is passed through. |
| `income` | An object with exactly the six keys below. | See each key. |
| `income.wages` | The year's wages, Form W-2 box 1, summed over every W-2. A finite number, zero or greater, with at most two decimal places. The engine also takes this as the Medicare wage base for the Additional Medicare Tax, in place of Form W-2 box 5, which this tool does not collect; where box 5 is higher, that tax is understated. | Form W-2 box 1. Box 5 is not collected. |
| `income.taxableInterest` | The year's taxable interest, Form 1099-INT box 1 plus box 3. Amount, as for wages. | Form 1099-INT box 1 plus box 3. |
| `income.ordinaryDividends` | The year's total ordinary dividends, Form 1099-DIV box 1a, qualified dividends included. Amount, as for wages. The engine is given box 1a minus box 1b, computed in whole cents. | Form 1099-DIV box 1a. |
| `income.qualifiedDividends` | Qualified dividends. Amount, as for wages. A `qualifiedDividends` greater than `ordinaryDividends` is refused, naming both. | Form 1099-DIV box 1b. |
| `income.shortTermCapitalGains` | The net short-term capital gain after netting, zero where the net is a loss. Amount, as for wages. A net capital loss is outside what this tool computes. | None beyond that net. |
| `income.longTermCapitalGains` | The net long-term capital gain after netting, zero where the net is a loss. Amount, as for wages. A net capital loss is outside what this tool computes. | None beyond that net. |
| `spouseItemizes` | A boolean. Required when `filingStatus` is `mfs`, and refused by name as an unknown key for any other filing status. `false`: the spouse does not itemize deductions on a separate return (26 U.S.C. § 63(c)(6)(A)). Passed to the engine in its filing group. `true` is outside the list this tool supports, because this tool collects no itemized deductions and the engine would treat them as zero. | 26 U.S.C. § 63(c)(6)(A). |
| `estimate` | Required when `operation` is `estimate`, and refused by name when `operation` is `liability`. An object with exactly the six keys below. | See each key. |
| `estimate.federalTaxWithheld` | The federal income tax withheld for the whole tax year, already withheld plus still to be withheld, Form W-2 box 2, plus any Additional Medicare Tax withheld (Form W-2 box 6 above 1.45% of box 5), summed over every W-2. Estimated payments are excluded, because the regular installment method treats withholding, and only withholding, as paid evenly through the year (26 U.S.C. § 6654(g)). The engine's own description also folds in estimated payments. This tool's definition does not. Amount, as for wages. | Form W-2 box 2, plus Form W-2 box 6 above 1.45% of box 5. 26 U.S.C. § 6654(g). |
| `estimate.priorYearTax` | The total tax shown on the preceding year's return. Amount, as for wages. | The total tax on that return. |
| `estimate.priorYearAGI` | The adjusted gross income shown on the preceding year's return. Amount, as for wages. | The adjusted gross income on that return. |
| `estimate.priorYearReturnFiled` | A boolean. `true`: a return was filed for the preceding taxable year. The tool gates on it and does not send it to the engine. | None on the fact line. The refusal names 26 U.S.C. 6654(d)(1)(B), closing sentence. |
| `estimate.priorYearTwelveMonths` | A boolean. `true`: that preceding year was a taxable year of 12 months. The tool gates on it and does not send it to the engine. | None on the fact line. The refusal names 26 U.S.C. 6654(d)(1)(B), closing sentence. |
| `estimate.farmerOrFisherman` | A boolean. `true` is outside the list this tool supports. `false` is sent to the engine as `isFarmerOrFisherman`. | None in this tool. |

Each of these, given as `operation`, is refused by its own name. The annualized installment method is not computed by this tool:

- `us.federal.estimated.annualized_installment_q1`
- `us.federal.estimated.annualized_installment_q2`
- `us.federal.estimated.annualized_installment_q3`
- `us.federal.estimated.annualized_installment_q4`

Any other engine target name, such as `us.federal.estimated.safe_harbor_met`, is refused by its own name the same way. An `operation` string other than `liability` or `estimate` is named before any other key in the file is.

A jurisdiction of `co` or `Colorado`, in any case and with surrounding space, is refused by name. Any other jurisdiction string is refused as unsupported.

`compute` sends the engine one request. `filing` carries `filingStatus`, and `spouseItemizes` only when `filingStatus` is `mfs`. `income` carries the six income amounts, with `ordinaryDividends` replaced by box 1a minus box 1b. For `estimate`, `payments_estimates` carries `federalTaxWithheld`, `priorYearTax`, `priorYearAGI`, and `isFarmerOrFisherman`. The two prior-year booleans are not in that request.

## The gate

The facts are judged before an install and before the engine starts. The first match is the refusal returned. A refusal prints one JSON object to stderr, leaves stdout empty, and exits 1. It carries `refused: true`, a `code`, the `subject` it names, a `message` with the cause and the fix, and `provenance.expected`. It carries no figure. `provenance.expected` holds the pinned `packageName`, `packageVersion`, `corpusName`, `corpusVersion`, and `corpusRoot`. That block is the pin the tool expected. A refusal has no `provenance.observed`, and it does not report a root the engine returned.

When one thing is named, `subject` is that string. When several are named, `subject` is an array of those strings.

| Code | What triggers it | What `subject` names |
|------|------------------|----------------------|
| `FACTS_UNREADABLE` | The facts file is longer than 1,000,000 characters, is not JSON, or is JSON but not one object. A file that cannot be opened is a usage error instead, plain text, with no code. | `facts` |
| `DUPLICATE_KEY` | A key is repeated. The file is parsed so a repeated key cannot drop a value. | The repeated key's path, such as `income.wages` |
| `FEATURE_UNSUPPORTED` | `operation` is an annualized target above, or any other string that is not `liability` or `estimate`. Also `spouseItemizes: true`, and `estimate.farmerOrFisherman: true`. | That operation string, or `spouseItemizes`, or `estimate.farmerOrFisherman` |
| `COLORADO` | `jurisdiction` is `co` or `Colorado`, in any case, with surrounding space ignored for the match. | The jurisdiction value as supplied |
| `UNKNOWN_KEY` | A key this tool does not accept, at any level. Includes `estimate` when `operation` is `liability`, and `spouseItemizes` when `filingStatus` is not `mfs`. | The key, or the keys |
| `FACTS_MISSING` | A required key is absent. For `estimate`, a missing `estimate` object names all six of its keys. For `mfs`, a missing `spouseItemizes` is named. | The key, or the keys |
| `INVALID_VALUE` | A present value has the wrong type or is outside its set: `operation` not a string, `jurisdiction` not a string, `taxYear` not an integer, `filingStatus` not one of the five tokens, `income` or `estimate` not an object, an amount that is not a finite number zero or greater with at most two decimal places, a boolean that is not `true` or `false`. Also `qualifiedDividends` greater than `ordinaryDividends`, compared in whole cents. | The fact's path. For the dividend pair, both paths. |
| `JURISDICTION_UNSUPPORTED` | `jurisdiction` is a string other than `federal` and other than Colorado. | That string |
| `YEAR_UNSUPPORTED` | `taxYear` is an integer other than 2025 or 2026. A non-integer is `INVALID_VALUE` instead. | That integer |
| `PRIOR_YEAR_INELIGIBLE` | `estimate.priorYearReturnFiled` or `estimate.priorYearTwelveMonths` is `false`, or both are. The engine applies the prior-year prong without testing that a return was filed for the preceding taxable year and that the year was 12 months (26 U.S.C. 6654(d)(1)(B), closing sentence). This tool returns no estimate unless both are `true`. | The false key, or both keys |
| `SCHEMA_REJECTED` | The engine rejects the request with JSON-RPC error `-32602`, either as that error code or as text that contains `-32602`. | The key path it names, the keys, or the string `-32602` when it names nothing |
| `NEEDS_FACTS` | The engine answers `ok: false` with error code `NEEDS_FACTS`. | The fact id it names, the ids, or the string `NEEDS_FACTS` when it names none |
| `NO_APPLICABLE_RULE` | The engine answers `ok: false` with error code `NO_APPLICABLE_RULE`. | The `asOf` it names, or `taxYear` when `asOf` is not a string |
| `ENGINE_REFUSED` | The engine answers `ok: false` with any other error code, or with no code. | That code, or `error` |
| `FACTS_DEFAULTED` | The engine answers `ok: true` and marks a needed fact as `source: default`. The needed facts for `liability` are `filingStatus`, `wages`, `taxableInterest`, `ordinaryDividends`, `qualifiedDividends`, `shortTermCapitalGains`, and `longTermCapitalGains`, plus `spouseItemizes` when `filingStatus` is `mfs`. For `estimate`, those plus `federalTaxWithheld`, `priorYearTax`, `priorYearAGI`, and `isFarmerOrFisherman`. A fact the tool already sent is still a refusal when the engine reports it as a default. | The fact id, or the ids |
| `PIN_ROOT` | The engine's `corpusMerkleRoot` is missing or is not the pinned root. Checked only after the needed-fact default check has passed. | `corpusMerkleRoot` |
| `NEGATIVE_FIGURE` | `valueCents` is a minus sign and digits. Refundable credits would exceed the tax, and this tool collects none of the facts a refundable credit rests on. | `valueCents` |
| `PIN_VERSION` | Before the engine starts, the installed package version is not the pin's `packageVersion`. | `packageVersion` |
| `PIN_BUNDLE` | Before the engine starts, `bundle/index.js` is present and its SHA-256 is not the pin's `bundleSha256`. | `bundle/index.js` |

A fault prints one JSON object to stderr, leaves stdout empty, and exits 1. It carries `refused: false`, a `code`, and a `message`. It carries no `subject`, no `provenance`, and no figure.

| Code | What triggers it |
|------|------------------|
| `PIN_UNREADABLE` | `pin.json` cannot be read, or it lacks any of the seven non-empty string keys The pin lists. `check` and `compute` both stop here, before an install. |
| `ENGINE_INCOMPLETE` | `node_modules/@invaro/opentax/package.json` is present and `bundle/index.js` is not. Nothing is started, including `bundle/main.js` and `bundle/http.js`. |
| `ENGINE_TIMEOUT` | The engine does not answer within 30 seconds. It is stopped. The bound is not a flag. |
| `ENGINE_CRASH` | The engine could not be started, exited before it answered, or stopped while the request was being sent. |
| `ENGINE_UNREADABLE` | The answer is not one this tool can read: a failed initialize, a JSON-RPC error other than `-32602`, no text result, a result that is not JSON and does not contain `-32602`, a result whose `ok` is not `true` or `false`, assumptions that are not an array, a `valueCents` that is not a string of 1 to 200 digits, or an `artifactHash` that is missing, empty, or longer than 200 characters. The message is fixed: the engine returned a response this tool could not read, so no figure is returned. |
| `ENGINE_FAULT` | The entry script itself throws. The message names the cause and points at `help`. |

Defaulted facts outside the needed lists are returned on a success, in `assumptions`, for the calling skill to put to the person. Each entry is `fact`, `value`, and `rationale`, taken from an engine assumption whose `source` is `default`. An assumption whose `source` is not `default` is not listed. A needed fact the engine marks `default` is `FACTS_DEFAULTED` instead, and no figure is returned, so those defaults are not in an answer. `spouseItemizes` is needed only when `filingStatus` is `mfs`. On any other filing status, a default of `spouseItemizes` is an assumption on the answer.

## The pin

`pin.json` in this tool's directory holds seven strings:

| Key | Value |
|-----|-------|
| `packageName` | `@invaro/opentax` |
| `packageVersion` | `0.4.0` |
| `bundleSha256` | `0975326041e325123a6b15015b0aadad3a8b9c3b884066130308a1616389de38` |
| `corpusName` | `@invaro/opentax-corpus-us-federal` |
| `corpusVersion` | `0.37.0` |
| `corpusMerkleRoot` | `sha256:6c422520ead11760adc2090b94426f61030743205515627fbc749f14fb498c8a` |
| `nodeRecorded` | `v25.1.0` |

`bundleSha256` is the SHA-256 of the engine's `bundle/index.js`. `nodeRecorded` is the Node version the pin was measured under.

The bundle hash and the package version are checked before each start. `compute` hashes `bundle/index.js` and reads the installed package version, and it starts the engine only when both equal the pin. `check` makes the same two comparisons and reports them. It does not start the engine, and it does not compare the corpus root.

The corpus root is checked on each computed result the tool would otherwise return as a figure: the engine answered `ok: true`, and no needed fact was defaulted. The returned `corpusMerkleRoot` must equal the pin. The pinned root covers the law's rules and fact definitions. It does not cover the version label, and it does not cover the evaluator's code. The bundle hash is the check on that code, and `packageVersion` is a separate check. On a success, `provenance.corpusName` and `provenance.corpusVersion` are the pin's values. `provenance.corpusRoot` is the root the engine returned, after it matched the pin.

The Node version is recorded, not authenticated. A success writes `provenance.node` as the Node that ran the tool, and `provenance.nodeRecorded` as the pin's value. Nothing compares them. `check` prints `nodeRecorded` and does not print the running version.

The checks hold only given a trusted Node and an installation nothing replaces between the hash and the launch. The tool hashes the bundle file, then starts that path. It does not hash the file again at the start, and it does not authenticate Node.

A move to another engine version is a deliberate change to the pin, and its hashes are re-measured. The tool refuses any other package version, bundle hash, or corpus root.

## Network and files

The tool itself makes no network call outside an authorised install. The install runs `npm ci --ignore-scripts --no-audit --no-fund` in this tool's directory. It reaches `registry.npmjs.org`. It writes `node_modules/` in this tool's directory. npm keeps its own cache outside the plugin. The install is the one place the parent's environment is passed on, to that `npm` process.

When `--install` or `WISER_ALLOW_INSTALL=1` authorises the install, the tool writes `.wiser-consent` at the plugin root as the install starts, before `npm ci` returns. The plugin root is the nearest ancestor directory that contains `tools/AGENTS.md`. The marker is one JSON object with `realpath`, `date` as `YYYY-MM-DD`, and `tool` set to `Tax Engine`, mode 0600. A marker that already matches is left as it is. A marker whose `realpath` differs, or a marker that cannot be read, is not consent. `help` never reads it. A survey `check` without `--install` never writes it.

The engine as published sends a usage ping on every start, and on its first start writes a notice file under the home directory at `.config/opentax/notice-shown`, unless it is opted out. The opt-out is `OPENTAX_TELEMETRY=0`, `OPENTAX_TELEMETRY=false`, or `DO_NOT_TRACK=1`. The tool starts the engine only with the opt-out set, and with nothing else inherited. The child is the same Node binary that is running the tool, with `bundle/index.js` as its only argument and no Node flags. The tool passes that child an environment of exactly `OPENTAX_TELEMETRY=0` and `DO_NOT_TRACK=1`, and does not pass the parent's environment on, `NODE_OPTIONS` included. The tool never starts `bundle/main.js` or `bundle/http.js`. The child's own error stream is discarded.

No fact is written to any file or log. A refusal's message can repeat a rejected value; that message is the refusal on stderr, not a file. The facts file is read through its resolved path. A symbolic link is read as the file it names. The consent marker holds no fact. The tool writes no output file.

## Output

`help` prints usage text to stdout and exits 0.

`check` prints one JSON object, exit 0:

| Field | Carries |
|-------|---------|
| `command` | `check` |
| `engine` | `absent`, `complete`, or `incomplete` |
| `bundleMatchesPin` | `true`, `false`, or `null` |
| `packageVersionMatchesPin` | `true`, `false`, or `null` |
| `pin` | The seven pin values |

`compute` prints one JSON object on a success, exit 0:

| Field | Carries |
|-------|---------|
| `operation` | `liability` or `estimate` |
| `jurisdiction` | `federal` |
| `taxYear` | `2025` or `2026` |
| `filingStatus` | The status that was stated |
| `figure.valueCents` | The engine's integer string of cents, unchanged |
| `figure.dollars` | That string formatted with a dollar sign, thousands separators, and two decimal places |
| `figure.label` | For `liability`: `Federal total tax net of refundable credits (Form 1040 lines 22 to 24)`. For `estimate`: `Required quarterly estimated payment by the regular installment method`. The engine's `meaning` is not copied. |
| `assumptions` | Defaulted facts outside the needed lists. Each is `fact`, `value`, and `rationale`. |
| `provenance.packageName` | The pin's package name |
| `provenance.packageVersion` | The pin's package version |
| `provenance.corpusName` | The pin's corpus name |
| `provenance.corpusVersion` | The pin's corpus version |
| `provenance.corpusRoot` | The engine's corpus root, after it matched the pin |
| `provenance.artifactHash` | The engine's artifact hash, passed through |
| `provenance.bundleHash` | The SHA-256 of `bundle/index.js` computed before the start |
| `provenance.node` | The Node version that ran the tool |
| `provenance.nodeRecorded` | The pin's recorded Node version |
| `statement` | `This is computation, not tax advice, and not a substitute for a licensed CPA, enrolled agent, or other tax professional.` |
| `estimateDetail` | Present only for `estimate`. The tool writes it. The engine does not. `fourRequiredInstallments` and `regularInstallmentMethod` and `withholdingTreatedAsPaidEvenly` are `true`. `annualizedInstallmentMethodComputed` is `false`. `statement` is `The figure is each of four required installments by the regular installment method. Withholding is treated as paid evenly. The annualized installment method was not computed.` |

A refusal is the object The gate describes, on stderr, exit 1, stdout empty. A fault is the object The gate describes, on stderr, exit 1, stdout empty. A usage error is plain text on stderr, exit 1, stdout empty, and it is not JSON.

## Script Contract

Every script in this tool follows `wiser/standards/script-contract.md`. What a user meets when running it is `wiser/tools/RUNNING.md`. Node 20 or later is the runtime, and `@invaro/opentax` installs by the consent-gated check above, so the tool carries no Dependencies section. No command takes `--env`. The sections above state what each command does. The contract states how the script behaves getting there.

## Troubleshooting

The stops every tool shares are in `wiser/tools/RUNNING.md`. The rows below are this tool's own. A JSON object on stderr is The gate: do what its `message` says, and do not state a figure.

| What you see | What to do |
|--------------|------------|
| `unknown option` or `unknown command` or `unexpected argument` | Run `node scripts/tax-engine.js help`. `--flag=value` is an unknown option. `-h` is an unknown option. |
| `a command is required` | Pass `help`, `check`, or `compute`. |
| `--facts is required` | Pass `--facts` and an absolute path. |
| `--facts must be an absolute path` | Pass an absolute path. A relative one is refused by name. |
| `--facts` `needs a value` or `was given more than once` | Pass the path once, as the next argument. |
| `--facts names` a path `which cannot be read` | The path is missing, not a file, or not readable. Pass a readable JSON file. |
| `this tool is not installed yet` | The report is the question. Re-run the same `compute` with `--install`, or set `WISER_ALLOW_INSTALL=1`. `check` without `--install` does not ask; it reports `engine` `absent`. |
| `npm ci cannot run because this is Node` | Install Node 20 or newer and run the same command with `--install` again. The consent marker was not written. |
| `is not writable` | The tool directory cannot be written. Install the plugin somewhere this account owns, then run the command again. |
| `npm ci failed` | Confirm Node 20 or newer, and that `package-lock.json` is present and matches `package.json`. Delete `node_modules/` in the tool directory and run the same command with `--install` again. The consent marker is written when the install starts, so a later `compute` in this copy will not ask. |
| `First run: installing dependencies` on stderr, and JSON on stdout | Expected. The result is the JSON. The line says an install just ran. |
| `check` exits 0 and `engine` is `absent` or `incomplete` | Read the fields. Exit 0 is the report, not a statement that the engine is ready. `compute` will refuse a version or hash mismatch before it starts the engine. |
| `refused` is `true` | No figure. `provenance.expected` is the pin. It is not a root the engine reported. |
| `refused` is `false` | A fault. No figure. The `message` names the next step. |
| `FACTS_DEFAULTED` for a fact the file already states | The engine treated that fact as a default. This tool will not pass the figure on. Do not restate the figure. |
| `assumptions` on a success | Defaults outside the needed lists. The calling skill puts each one to the person. They are not facts the person stated. |

## Success

- `node scripts/tax-engine.js help` and `--help` print usage to stdout and exit 0 on a copy with no `node_modules/` and no consent marker. The text names both operations, every fact, both engine targets, the four annualized targets, and `us.federal.estimated.safe_harbor_met`.
- `check` exits 0 with one JSON object. It does not start the engine. Without `--install` it does not install and does not write `.wiser-consent`, including when `WISER_ALLOW_INSTALL=1` is set. With `--install`, on a copy that has no package, it installs, writes the marker, and then reports.
- `compute` of a facts file that passes every gate exits 0 with one JSON object. `figure.valueCents` is the engine's digit string. `figure.label` comes from `operation`. `statement` is the sentence Output quotes. For `estimate`, `estimateDetail.annualizedInstallmentMethodComputed` is `false`.
- `assumptions` lists engine defaults outside the needed lists, and omits assumptions whose source is not `default`. A needed fact marked `default` exits 1 with `FACTS_DEFAULTED`, stdout empty, and no figure in the message.
- A refusal exits 1 with one JSON object on stderr, `refused` `true`, `provenance.expected` holding the pin, and no `provenance.observed`. A fault exits 1 with `refused` `false` and no figure.
- Colorado, in any case and with surrounding space, exits 1 with `COLORADO` before the engine starts. Any other jurisdiction string exits 1 with `JURISDICTION_UNSUPPORTED`.
- An unknown option is refused by name before any install, any read, and any start. A relative `--facts` is refused by name. `--facts --install` is not consent.
- The child environment the tool sets is `OPENTAX_TELEMETRY=0` and `DO_NOT_TRACK=1`, and the parent's environment is not passed to the child. The only argument is `bundle/index.js`.
- No run writes a fact to a file. The install writes `node_modules/` in this tool's directory, npm's cache outside the plugin, and, when the flag or `WISER_ALLOW_INSTALL=1` authorised it, `.wiser-consent` at the plugin root.
