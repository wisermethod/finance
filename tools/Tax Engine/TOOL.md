---
name: Tax Engine
type: tool
category: tax
description: One JSON object with a federal figure from stated facts, the total tax or a quarterly estimate under the regular method, or a check of the pinned engine
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

A minimal `liability` file, with every amount stated and zero where the person has none, and every profile attestation false:

```json
{
  "operation": "liability",
  "jurisdiction": "federal",
  "taxYear": 2025,
  "filingStatus": "single",
  "profile": {
    "otherIncome": false,
    "adjustmentsOrItemizing": false,
    "credits": false,
    "dependents": false,
    "ageOrBlindness": false,
    "claimableAsDependent": false,
    "otherTaxes": false
  },
  "income": {
    "wages": 0,
    "medicareWages": 0,
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

The file is one JSON object, UTF-8. A leading byte-order mark is removed. Every key below is required unless a line says otherwise. Any other key, at any level, is refused by name before the engine starts. Zero is a value the person states, not a default this tool fills in. Omitting a required fact is a refusal, not a zero. A profile attestation of `false` is a value the person states. The tool does not fill one in.

| Fact | Definition | Document line |
|------|------------|---------------|
| `operation` | `liability` or `estimate`. `liability` is the federal total tax, Form 1040 line 24, less refundable credits: income tax plus self-employment tax, net investment income tax and Additional Medicare Tax, less refundable credits. The engine target is `us.federal.net_tax`. `estimate` is the required quarterly estimated payment by the regular installment method. The tool also asks the engine for `us.federal.balance_due` and `us.federal.estimated.required_annual_payment` and applies 26 U.S.C. § 6654(e)(1): when the balance due after withholding is below $1,000, or the withholding stated reaches the required annual payment, the figure is zero, no required quarterly estimated payment under 26 U.S.C. § 6654(e), and the answer still carries the regular-method installment and the determination. Otherwise the figure is the regular-method installment. The engine target is `us.federal.estimated.quarterly_payment`. The estimate's current-year tax is the engine's liability computation, which takes the tax from the IRS Tax Table for taxable income under $100,000 as the return itself does, where Form 1040-ES's worksheet uses the rate schedules, so the two can differ by a few dollars. Output states the boundary in cents and the fields each arm carries. | Form 1040 line 24, less refundable credits, for `liability`. The regular estimate names no form line. The no-payment figure names 26 U.S.C. § 6654(e). |
| `jurisdiction` | The string `federal`, exactly. | None. This tool computes a federal figure only. |
| `taxYear` | The digits `2025` or `2026`, with no decimal point and no exponent. A JSON string, a decimal, or an exponent is `INVALID_VALUE`, and the message shows the lexeme as written. The tool asks the engine for that year's 31 December, as `asOf`. | The date sent is `<taxYear>-12-31`. |
| `filingStatus` | `single`, `mfj`, `mfs`, `hoh`, or `qss`. | None in this tool. The token is passed through. |
| `income` | An object with exactly the seven keys below, each an amount: digits, with an optional decimal point and one or two digits after it, zero or greater. A sign or an exponent is refused. A JSON string is refused. The engine receives each amount as an exact decimal string built from those whole cents. | See each key. |
| `income.wages` | The year's wages, Form W-2 box 1, summed over every W-2. An amount, as for income. | Form W-2 box 1. |
| `income.medicareWages` | The year's Medicare wages and tips, Form W-2 box 5, summed over every W-2. An amount, as for wages. It is sent as its own amount. It is not copied from `wages`. A default of it is `FACTS_DEFAULTED`. Zero while `wages` is above zero is `FEATURE_UNSUPPORTED`: the engine reads a zero box 5 as absent and substitutes box 1, so wages exempt from Medicare tax are outside this tool. Zero for both is accepted and is sent as `0.00`. | Form W-2 box 5. |
| `income.taxableInterest` | The year's taxable interest, Form 1099-INT box 1 plus box 3. An amount, as for wages. | Form 1099-INT box 1 plus box 3. |
| `income.ordinaryDividends` | The year's total ordinary dividends, Form 1099-DIV box 1a, qualified dividends included. An amount, as for wages. The engine is given box 1a minus box 1b, computed in whole cents. | Form 1099-DIV box 1a. |
| `income.qualifiedDividends` | Qualified dividends, Form 1099-DIV box 1b. An amount, as for wages. A `qualifiedDividends` greater than `ordinaryDividends` is refused, naming both. | Form 1099-DIV box 1b. |
| `income.shortTermCapitalGains` | The net short-term capital gain after netting, zero where the net is a loss. An amount, as for wages. A net capital loss is outside what this tool computes. | None beyond that net. |
| `income.longTermCapitalGains` | The net long-term capital gain after netting, zero where the net is a loss. An amount, as for wages. A net capital loss is outside what this tool computes. | None beyond that net. |
| `profile` | An object with exactly these keys, each a boolean. Each must be false for a figure to be computed. true is outside what this tool computes. None of these is sent to the engine. The engine defaults every fact this tool does not collect, and the attestations bound the tool to the filer it computes for. | None. The seven attestations are this tool's. |
| `profile.otherIncome` | The filer or spouse had income of any kind other than the wages, interest, dividends and net capital gains above, such as self-employment or business income, rental income, retirement plan or IRA distributions, Social Security benefits, unemployment compensation or alimony, or had a net capital loss. Must be `false` for a figure. | None. This tool collects none of that income. |
| `profile.adjustmentsOrItemizing` | The filer or spouse has any adjustment to income or any deduction other than the standard deduction, such as IRA, HSA or self-employed retirement contributions, student loan interest, educator expenses, the deductions for qualified tips, qualified overtime, car loan interest or seniors, or itemizes. Must be `false` for a figure. | None. This tool collects none of those adjustments or deductions. |
| `profile.credits` | The filer or spouse claims any credit, such as the child tax credit, the credit for other dependents, an education, child and dependent care, energy, adoption, foreign tax, earned income or premium tax credit, or a credit for excess Social Security tax withheld. Must be `false` for a figure. | None. This tool collects no credit. |
| `profile.dependents` | The filer claims anyone as a dependent. Must be `false` for a figure. | None. This tool collects no dependent. |
| `profile.ageOrBlindness` | The filer or spouse was 65 or older, or blind, at the end of the tax year. Must be `false` for a figure. | None. This tool collects neither age nor blindness. |
| `profile.claimableAsDependent` | The filer or spouse can be claimed as someone else's dependent. Must be `false` for a figure. | None. This tool collects no such claim. |
| `profile.otherTaxes` | The filer or spouse owes any federal tax other than the income tax, net investment income tax and Additional Medicare Tax on the facts above, such as household employment taxes for a household employee (Schedule H), the alternative minimum tax from an incentive stock option exercise or another preference, an additional tax on a retirement plan or HSA distribution, or the repayment of advance premium tax credit. Must be `false` for a figure. | None. This tool collects none of those taxes. |
| `spouseItemizes` | A boolean. Required when `filingStatus` is `mfs`, and refused by name as an unknown key for any other filing status. `false`: the spouse does not itemize deductions on a separate return (26 U.S.C. § 63(c)(6)(A)). Passed to the engine in its filing group. `true` is outside the list this tool supports, because this tool collects no itemized deductions and the engine would treat them as zero. | 26 U.S.C. § 63(c)(6)(A). |
| `estimate` | Required when `operation` is `estimate`, and refused by name when `operation` is `liability`. An object with exactly the seven keys below. | See each key. |
| `estimate.federalTaxWithheld` | All federal income tax withheld for the year: Form W-2 box 2, Additional Medicare Tax withheld (box 6 above 1.45% of box 5), and box 4 of every Form 1099-INT and 1099-DIV. The federal income tax withheld for the whole tax year, already withheld plus still to be withheld, Form W-2 box 2, plus any Additional Medicare Tax withheld (Form W-2 box 6 above 1.45% of box 5), summed over every W-2. Estimated payments are excluded, because the regular installment method treats withholding, and only withholding, as paid evenly through the year (26 U.S.C. § 6654(g)). The engine's own description also folds in estimated payments. This tool's definition does not. An amount, as for income. The withholding arm of the § 6654(e)(1) check uses this stated amount, in whole cents. | Form W-2 box 2, Additional Medicare Tax withheld (Form W-2 box 6 above 1.45% of box 5), and box 4 of every Form 1099-INT and 1099-DIV. Estimated payments are excluded. 26 U.S.C. § 6654(g). |
| `estimate.priorYearTax` | The total tax shown on the preceding year's return, Form 1040 line 24, as amended if it was. With `priorYearAdjusted` false, that amount is the one 26 U.S.C. § 6654(d)(1)(B) uses. Amount, as for income. | Form 1040 line 24, as amended if it was. With `priorYearAdjusted` false, 26 U.S.C. § 6654(d)(1)(B). |
| `estimate.priorYearAGI` | The adjusted gross income shown on the preceding year's return. Amount, as for income. | The adjusted gross income on that return. |
| `estimate.priorYearReturnFiled` | A boolean. `true`: a return was filed for the preceding taxable year. The tool gates on it and does not send it to the engine. | None on the fact line. The refusal names 26 U.S.C. 6654(d)(1)(B), closing sentence. |
| `estimate.priorYearTwelveMonths` | A boolean. `true`: that preceding year was a taxable year of 12 months. The tool gates on it and does not send it to the engine. | None on the fact line. The refusal names 26 U.S.C. 6654(d)(1)(B), closing sentence. |
| `estimate.priorYearAdjusted` | A boolean that must be `false`. `true`: the preceding year's return claimed any refundable credit (such as the earned income credit, the additional child tax credit, the refundable part of the American opportunity credit or a net premium tax credit), or the filer filed a joint return in one of the two years and a separate return in the other. `true` is `FEATURE_UNSUPPORTED`. The tool gates on it and does not send it to the engine. | None on the fact line. The refusal names 26 U.S.C. § 6654(d)(1)(B). |
| `estimate.farmerOrFisherman` | A boolean. `true` is outside the list this tool supports. `false` is sent to the engine as `isFarmerOrFisherman`. | None in this tool. |

Each of these, given as `operation`, is refused by its own name. The annualized installment method is not computed by this tool:

- `us.federal.estimated.annualized_installment_q1`
- `us.federal.estimated.annualized_installment_q2`
- `us.federal.estimated.annualized_installment_q3`
- `us.federal.estimated.annualized_installment_q4`

Any other engine target name, such as `us.federal.estimated.safe_harbor_met`, is refused by its own name the same way. That includes `us.federal.balance_due` and `us.federal.estimated.required_annual_payment` when either is given as `operation`. An `operation` string other than `liability` or `estimate` is named before any other key in the file is.

A jurisdiction of `co` or `Colorado`, in any case and with surrounding space, is refused by name. Any other jurisdiction string is refused as unsupported.

A `liability` compute sends one request, target `us.federal.net_tax`. An `estimate` compute sends three, on one engine, in this order: `us.federal.estimated.quarterly_payment`, then `us.federal.balance_due`, then `us.federal.estimated.required_annual_payment`. The tool does not send `us.federal.estimated.safe_harbor_met`. No figure is returned unless every request's answer passes The gate. The first failure is the result, in that order.

Each request carries `target`, and `asOf` as `<taxYear>-12-31`. `filing` carries `filingStatus`, and `spouseItemizes` only when `filingStatus` is `mfs`. `income` carries the seven amounts. `profile` is not in the request. For `estimate`, every request also carries `payments_estimates` with `federalTaxWithheld`, `priorYearTax`, `priorYearAGI`, and `isFarmerOrFisherman`. `priorYearReturnFiled`, `priorYearTwelveMonths`, and `priorYearAdjusted` are not in the request.

Each amount is taken from its JSON lexeme in whole cents: two digits after the point are the cents, one digit is the tenths and the hundredths are zero, and no point means zero cents. `ordinaryDividends` is then box 1a minus box 1b in those cents. Box 1a of 10.25 and box 1b of 0.10 are sent as ordinary dividends `10.15` and qualified dividends `0.10`. Every sent amount is a string of digits, a point, and exactly two digits, with no sign and no thousands separator. Zero is sent as `0.00`. One digit after the point is padded, so 160000.5 is sent as `160000.50`.

## The gate

The facts are judged before an install and before the engine starts. A compute then checks the pin, starts the engine, and judges each answer. The first match is the result returned. A refusal prints one JSON object to stderr, leaves stdout empty, and exits 1. It carries `refused: true`, a `code`, the `subject` it names, a `message` with the cause and the fix, and `provenance.expected`. It carries no figure. `provenance.expected` holds the pinned `packageName`, `packageVersion`, `corpusName`, `corpusVersion`, and `corpusRoot`. That block is the pin the tool expected. A refusal has no `provenance.observed`, and it does not report a root the engine returned.

When one thing is named, `subject` is that string. When several are named, `subject` is an array of those strings.

The walk on `compute` is one order. `PIN_UNREADABLE` is first. Then the refusal rows from `FACTS_UNREADABLE` through `PRIOR_YEAR_INELIGIBLE`. Then `ENGINE_INCOMPLETE`, then `PIN_VERSION` and `PIN_BUNDLE`, and only then the engine starts. During the call, `ENGINE_TIMEOUT`, `ENGINE_CRASH`, and `ENGINE_UNREADABLE` can fire. On each answer the walk is `SCHEMA_REJECTED`, `NEEDS_FACTS`, `NO_APPLICABLE_RULE`, `ENGINE_REFUSED`, `RESULT_MISMATCH`, `FACTS_DEFAULTED`, `PIN_ROOT`, `NEGATIVE_FIGURE`, and `ENGINE_UNREADABLE` again for a cents string or an artifact hash this tool will not accept. An estimate walks that answer list three times, quarterly installment, then balance due, then required annual payment, and stops at the first failure. `ENGINE_FAULT` is the entry script throwing. Each table lists a code once, at its first check. `FEATURE_UNSUPPORTED` and `INVALID_VALUE` are also returned later, where their rows say so.

| Code | What triggers it | What `subject` names |
|------|------------------|----------------------|
| `FACTS_UNREADABLE` | The facts file is longer than 1,000,000 characters, is not JSON, or is JSON but not one object. A number that starts with zero and continues with another digit, such as `01`, is not JSON here. A file that cannot be opened is a usage error instead, plain text, with no code. | `facts` |
| `DUPLICATE_KEY` | A key is repeated. The file is parsed so a repeated key cannot drop a value. | The repeated key's path, such as `income.wages` |
| `FEATURE_UNSUPPORTED` | First, when `operation` is a string other than `liability` or `estimate`, before any other key. That covers each annualized target above, and any other engine target name. Later, after that field's own value check: one or more profile attestations set to `true`; `income.medicareWages` of zero while `income.wages` is above zero, after the income amounts are valid and before the dividend comparison; `spouseItemizes` set to `true`; `estimate.farmerOrFisherman` set to `true`; `estimate.priorYearAdjusted` set to `true`, after the farmer check and before `PRIOR_YEAR_INELIGIBLE`. | The operation string. For profile, `profile.<name>`, or those paths in the order `otherIncome`, `adjustmentsOrItemizing`, `credits`, `dependents`, `ageOrBlindness`, `claimableAsDependent`, `otherTaxes` when more than one is `true`. For the Medicare wage pair, `income.medicareWages`. Otherwise `spouseItemizes`, `estimate.farmerOrFisherman`, or `estimate.priorYearAdjusted`. |
| `COLORADO` | `jurisdiction` is `co` or `Colorado`, in any case, with surrounding space ignored for the match. | The jurisdiction value as supplied |
| `UNKNOWN_KEY` | A key this tool does not accept, at any level. Includes `estimate` when `operation` is `liability`, `spouseItemizes` when `filingStatus` is not `mfs`, and any key inside `profile` or `income` that is not in the vocabulary. | The key, or the keys |
| `FACTS_MISSING` | A required key is absent. A missing `profile` names all seven `profile.<name>` paths, in the attestation order above. One missing attestation names that path. A missing `income` names all seven income paths, including `income.medicareWages`. For `estimate`, a missing `estimate` object names all seven of its keys, in the order `federalTaxWithheld`, `priorYearTax`, `priorYearAGI`, `priorYearReturnFiled`, `priorYearTwelveMonths`, `priorYearAdjusted`, `farmerOrFisherman`. For `mfs`, a missing `spouseItemizes` is named. | The key, or the keys |
| `INVALID_VALUE` | A present value has the wrong type or is outside its set. In order: `operation` not a string; `jurisdiction` not a string; `taxYear` not a digit lexeme; `filingStatus` not one of the five tokens; `profile` not an object; a profile value not a boolean. A `true` profile attestation is `FEATURE_UNSUPPORTED` before the income checks. Then: `income` not an object; an income amount whose lexeme is not digits with an optional decimal point and one or two digits after it (a JSON string, a sign, an exponent, or a longer fraction). `income.medicareWages` of zero while `income.wages` is above zero is `FEATURE_UNSUPPORTED`, not this code. Then `qualifiedDividends` greater than `ordinaryDividends`, compared in whole cents. After the jurisdiction and year codes: `spouseItemizes` not a boolean when `filingStatus` is `mfs`; `estimate` not an object; an estimate amount outside that amount rule; an estimate value that is not `true` or `false`. `estimate.farmerOrFisherman` set to `true`, then `estimate.priorYearAdjusted` set to `true`, are `FEATURE_UNSUPPORTED`, not this code, and both are checked before `PRIOR_YEAR_INELIGIBLE`. | The fact's path. For the dividend pair, both paths. |
| `JURISDICTION_UNSUPPORTED` | `jurisdiction` is a string other than `federal` and other than Colorado. | That string |
| `YEAR_UNSUPPORTED` | `taxYear` is digits other than 2025 or 2026. A decimal point or an exponent is `INVALID_VALUE` instead. | That year as a number when the lexeme has at most 15 digits, and the digit string when it is longer |
| `PRIOR_YEAR_INELIGIBLE` | `estimate.priorYearReturnFiled` or `estimate.priorYearTwelveMonths` is `false`, or both are. The engine applies the prior-year prong without testing that a return was filed for the preceding taxable year and that the year was 12 months (26 U.S.C. 6654(d)(1)(B), closing sentence). This tool returns no estimate unless both are `true`. | The false key, or both keys |
| `PIN_VERSION` | Before the engine starts, the installed package version is not the pin's `packageVersion`. | `packageVersion` |
| `PIN_BUNDLE` | Before the engine starts, `bundle/index.js` is present and its SHA-256 is not the pin's `bundleSha256`. | `bundle/index.js` |
| `SCHEMA_REJECTED` | The engine rejects the request with JSON-RPC error `-32602`, either as that error code or as text that contains `-32602`. On an estimate, judged on the quarterly answer, then the balance, then the required payment. | The key path it names, the keys, or the string `-32602` when it names nothing |
| `NEEDS_FACTS` | The engine answers `ok: false` with error code `NEEDS_FACTS`. On an estimate, the same three-answer order. | The fact id it names, the ids, or the string `NEEDS_FACTS` when it names none |
| `NO_APPLICABLE_RULE` | The engine answers `ok: false` with error code `NO_APPLICABLE_RULE`. On an estimate, the same three-answer order. | The `asOf` it names, or `taxYear` when `asOf` is not a string |
| `ENGINE_REFUSED` | The engine answers `ok: false` with any other error code, or with no code. On an estimate, the same three-answer order. | That code, or `error` |
| `FACTS_DEFAULTED` | The engine answers `ok: true` and marks a needed fact as `source: default`. The needed facts for `liability` are `filingStatus`, `wages`, `medicareWages`, `taxableInterest`, `ordinaryDividends`, `qualifiedDividends`, `shortTermCapitalGains`, and `longTermCapitalGains`, plus `spouseItemizes` when `filingStatus` is `mfs`. For `estimate`, those plus `federalTaxWithheld`, `priorYearTax`, `priorYearAGI`, and `isFarmerOrFisherman`. `priorYearReturnFiled`, `priorYearTwelveMonths`, and `priorYearAdjusted` are not engine facts. None of the profile attestations is an engine fact. A fact the tool already sent is still a refusal when the engine reports it as a default. On an estimate this is judged on the quarterly answer, then the balance, then the required payment. | The fact id, or the ids |
| `PIN_ROOT` | The engine's `corpusMerkleRoot` on the answer being judged is missing or is not the pinned root. Checked only after that answer's target and date matched the request and its needed-fact default check has passed. On an estimate, a mismatch on the balance or the required payment is this code even when the quarterly answer matched. | `corpusMerkleRoot` |
| `NEGATIVE_FIGURE` | `valueCents` is a minus sign and digits, on a liability answer, on the quarterly installment, or on the required annual payment. Refundable credits would exceed the tax, and this tool collects none of the facts a refundable credit rests on. A negative quarterly installment is this code, and it is not turned into a zero estimate. The balance-due answer is not this code: a minus there is allowed, and that figure is below $1,000 for the estimate check. | `valueCents` |

A fault prints one JSON object to stderr, leaves stdout empty, and exits 1. It carries `refused: false`, a `code`, and a `message`. It carries no `subject`, no `provenance`, and no figure.

| Code | What triggers it |
|------|------------------|
| `PIN_UNREADABLE` | `pin.json` cannot be read, or it lacks any of the seven non-empty string keys The pin lists. `check` and `compute` both stop here, before an install. On `compute` this is before the facts are read. |
| `ENGINE_INCOMPLETE` | `node_modules/@invaro/opentax/package.json` is present and `bundle/index.js` is not. Judged after `PRIOR_YEAR_INELIGIBLE` and before `PIN_VERSION`. Nothing is started, including `bundle/main.js` and `bundle/http.js`. |
| `ENGINE_TIMEOUT` | The engine does not answer within 30 seconds. It is stopped. The bound is not a flag. |
| `ENGINE_CRASH` | The engine could not be started, exited before it answered, or stopped while the request was being sent. |
| `ENGINE_UNREADABLE` | The answer is not one this tool can read: a failed initialize, a JSON-RPC error other than `-32602`, no text result, a result that is not JSON and does not contain `-32602`, a result whose `ok` is not `true` or `false`, assumptions that are not an array, a `valueCents` that is not a string of 1 to 200 digits, or, on the balance-due answer only, an optional leading minus and those digits, or an `artifactHash` that is missing, empty, or longer than 200 characters. A target or a date that differs from the request is `RESULT_MISMATCH`, not this code. The message is fixed: the engine returned a response this tool could not read, so no figure is returned. |
| `RESULT_MISMATCH` | The answer's `target` or `asOf` differs from the target requested and that tax year's 31 December. An answer that carries no `target`, or no `asOf`, is this fault. Judged on each answer after `ENGINE_REFUSED` and before `FACTS_DEFAULTED`. The message names the target and the date returned, using none when that field is absent, and the target and the date requested. A liability must come back as `us.federal.net_tax`. An estimate must come back as the target that request asked for. |
| `ENGINE_FAULT` | The entry script itself throws. The message names the cause and points at `help`. |

Defaulted facts outside the needed lists are returned on a success, in `assumptions`, for the calling skill to put to the person. Each entry is `fact`, `value`, and `rationale`, taken from an engine assumption whose `source` is `default`. The name is the assumption's `factId` when that is a string, and otherwise its `fact`. An assumption whose `source` is not `default` is not listed. An assumption with `source` `default` and no string name is omitted. A needed fact the engine marks `default` is `FACTS_DEFAULTED` instead, and no figure is returned, so those defaults are not in an answer. The needed facts are the `FACTS_DEFAULTED` row. `spouseItemizes` is needed only when `filingStatus` is `mfs`. On any other filing status, a default of `spouseItemizes` is an assumption on the answer. On an estimate, `assumptions` are taken from the quarterly answer only. A needed-fact default on the balance answer or the required-payment answer is `FACTS_DEFAULTED`. Defaults on those two answers that are outside the needed lists are not copied onto the success.

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

The corpus root is checked on each engine answer the operation asked for, once that answer has `ok: true`, its target and date match the request, and no needed fact on it was defaulted. A liability asks for one answer. An estimate asks for three, and a root that differs on any of them is `PIN_ROOT`. The pinned root covers the law's rules and fact definitions. It does not cover the version label, and it does not cover the evaluator's code. The bundle hash is the check on that code, and `packageVersion` is a separate check. On a success, `provenance.corpusName` and `provenance.corpusVersion` are the pin's values. `provenance.corpusRoot` is the root the quarterly answer returned for an estimate, and the one answer returned for a liability, after it matched the pin.

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
| `figure.valueCents` | For `liability`, the engine's integer string of cents, unchanged. For `estimate`, the arm table below. |
| `figure.dollars` | That string formatted with a dollar sign, thousands separators, and two decimal places. The same formatting is used for `estimateDetail.regularMethodInstallment.dollars`. |
| `figure.label` | For `liability`: `Federal total tax, Form 1040 line 24, less refundable credits`. For `estimate`: the arm table below. The engine's `meaning` is not copied. |
| `assumptions` | Defaulted facts outside the needed lists. Each is `fact`, `value`, and `rationale`. On an estimate, the quarterly answer's defaults only. |
| `provenance.packageName` | The pin's package name |
| `provenance.packageVersion` | The pin's package version |
| `provenance.corpusName` | The pin's corpus name |
| `provenance.corpusVersion` | The pin's corpus version |
| `provenance.corpusRoot` | The engine's corpus root on the liability answer, or on the quarterly answer for an estimate, after it matched the pin |
| `provenance.artifactHash` | The engine's artifact hash on that same answer, passed through |
| `provenance.bundleHash` | The SHA-256 of `bundle/index.js` computed before the start |
| `provenance.node` | The Node version that ran the tool |
| `provenance.nodeRecorded` | The pin's recorded Node version |
| `statement` | `This is computation, not tax advice, and not a substitute for a licensed CPA, enrolled agent, or other tax professional.` |
| `estimateDetail` | Present only for `estimate`. The tool writes it. The engine does not. The arm table lists its fields. |

The estimate's current-year tax is the engine's liability computation, which takes the tax from the IRS Tax Table for taxable income under $100,000 as the return itself does, where Form 1040-ES's worksheet uses the rate schedules, so the two can differ by a few dollars.

An `estimate` applies 26 U.S.C. § 6654(e)(1) only after the quarterly answer, the balance-due answer, and the required-payment answer have each passed The gate. The balance arm is the engine's `us.federal.balance_due` figure. It is true when that figure is below $1,000, applied as less than 100000 cents. A negative balance due is below that line. A balance of exactly 100000 cents, $1,000.00, is not. The withholding arm is the withholding stated. It is true when that stated amount, in whole cents, reaches the engine's `us.federal.estimated.required_annual_payment` figure, applied as greater than or equal to that figure's cents. One cent short is not. The tool does not recompute either engine figure. The determination is true when either arm is true. The tool does not ask for `us.federal.estimated.safe_harbor_met`.

| Field | Either arm true | Both arms false |
|-------|-----------------|-----------------|
| `figure.valueCents` | `0` | The quarterly installment's cents, unchanged |
| `figure.dollars` | `$0.00` | That installment, formatted |
| `figure.label` | `No required quarterly estimated payment under 26 U.S.C. § 6654(e)` | `Required quarterly estimated payment by the regular installment method` |
| `estimateDetail.determination` | `true` | `false` |
| `estimateDetail.fourRequiredInstallments` | `false` | `true` |
| `estimateDetail.regularInstallmentMethod` | `true` | `true` |
| `estimateDetail.withholdingTreatedAsPaidEvenly` | `true` | `true` |
| `estimateDetail.annualizedInstallmentMethodComputed` | `false` | `false` |
| `estimateDetail.regularMethodInstallment.valueCents` | The quarterly installment's cents, unchanged | The same cents, which are also `figure.valueCents` |
| `estimateDetail.regularMethodInstallment.dollars` | That installment, formatted | That installment, formatted |
| `estimateDetail.statement` | `No required quarterly estimated payment under 26 U.S.C. § 6654(e). The regular-method installment is carried with this answer. Withholding is treated as paid evenly. The annualized installment method was not computed.` | `The figure is each of four required installments by the regular installment method. Withholding is treated as paid evenly. The annualized installment method was not computed.` |

`assumptions`, `provenance`, and `statement` are on the answer in both arms.

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
| `RESULT_MISMATCH` | The engine's target or date is missing or differs from the request. No figure. Confirm the installed engine is `@invaro/opentax` 0.4.0 and run the command again. |
| `FACTS_DEFAULTED` for a fact the file already states | The engine treated that fact as a default. This tool will not pass the figure on. Do not restate the figure. `medicareWages` is a needed fact, so a default of it is this code. On an estimate, a needed-fact default on the balance answer or the required-payment answer is this code, and no figure is returned. |
| `FEATURE_UNSUPPORTED` naming `profile.<name>` | That attestation is `true`. A figure is computed only when each profile boolean is `false`, and only when that statement is true of the filer. `profile.otherTaxes` is `true` when the filer or spouse owes a federal tax this tool does not compute, such as household employment taxes, the alternative minimum tax from an incentive stock option exercise, an additional tax on a retirement plan or HSA distribution, or repayment of advance premium tax credit. |
| `FEATURE_UNSUPPORTED` naming `income.medicareWages` | Box 5 is zero and box 1 is above zero. The engine would read that zero as absent and substitute box 1. Wages exempt from Medicare tax are outside this tool. Pass zero for both only when there are no wages. |
| `FEATURE_UNSUPPORTED` naming `estimate.priorYearAdjusted` | The preceding year's return claimed a refundable credit, or the filer filed a joint return in one of the two years and a separate return in the other. Pass `false` only when neither is true. The fact is not sent to the engine. |
| `assumptions` on a success | Defaults outside the needed lists. The calling skill puts each one to the person. They are not facts the person stated. On an estimate they come from the quarterly answer only. |
| `figure.valueCents` is `0` and `estimateDetail.determination` is `true` | No quarterly payment is required under 26 U.S.C. § 6654(e). The regular-method installment is `estimateDetail.regularMethodInstallment`, not `figure`. |

## Success

- `node scripts/tax-engine.js help` and `--help` print usage to stdout and exit 0 on a copy with no `node_modules/` and no consent marker. The text names both operations, every fact, `medicareWages`, `profile` and its seven attestations, `otherTaxes`, `priorYearAdjusted`, both engine targets, `us.federal.balance_due`, `us.federal.estimated.required_annual_payment`, the four annualized targets, and `us.federal.estimated.safe_harbor_met`. It states the Form 1040 line 24 liability wording, the withholding wording that includes box 4 of Form 1099-INT and Form 1099-DIV, 26 U.S.C. § 6654(e)(1), the Form 1040 line 24 definition of `priorYearTax`, the zero box 5 refusal, and that the estimate's current-year tax is the engine's liability computation, which takes the tax from the IRS Tax Table for taxable income under $100,000 as the return itself does, where Form 1040-ES's worksheet uses the rate schedules, so the two can differ by a few dollars.
- `check` exits 0 with one JSON object. It does not start the engine. Without `--install` it does not install and does not write `.wiser-consent`, including when `WISER_ALLOW_INSTALL=1` is set. With `--install`, on a copy that has no package, it installs, writes the marker, and then reports.
- `compute` of a facts file that passes every gate exits 0 with one JSON object. For `liability`, `figure.valueCents` is the engine's digit string and `figure.label` is `Federal total tax, Form 1040 line 24, less refundable credits`. `statement` is the sentence Output quotes.
- For `estimate`, either § 6654(e)(1) arm true: `figure.valueCents` is `0`, `figure.dollars` is `$0.00`, `figure.label` is `No required quarterly estimated payment under 26 U.S.C. § 6654(e)`, `estimateDetail.determination` is `true`, `estimateDetail.fourRequiredInstallments` is `false`, and `estimateDetail.regularMethodInstallment` carries the quarterly installment. Both arms false: `figure.valueCents` is that installment, `figure.label` is `Required quarterly estimated payment by the regular installment method`, `estimateDetail.determination` is `false`, and `estimateDetail.fourRequiredInstallments` is `true`. `estimateDetail.annualizedInstallmentMethodComputed` is `false` on both arms. A balance of exactly $1,000.00 does not meet the balance arm. Stated withholding equal to the required annual payment meets the withholding arm. One cent short does not. A negative balance due meets the balance arm.
- `assumptions` lists engine defaults outside the needed lists, from the liability answer or, on an estimate, from the quarterly answer only, and omits assumptions whose source is not `default`. A needed fact marked `default`, including `medicareWages`, exits 1 with `FACTS_DEFAULTED`, stdout empty, and no figure in the message.
- A profile attestation set to `true` exits 1 with `FEATURE_UNSUPPORTED` and subject `profile.<name>`, before the engine starts. A missing attestation, or a missing `profile`, exits 1 with `FACTS_MISSING`. A missing `income.medicareWages` exits 1 with `FACTS_MISSING`. `income.medicareWages` of zero while `income.wages` is above zero exits 1 with `FEATURE_UNSUPPORTED` and subject `income.medicareWages`, before the engine starts. Zero for both is accepted.
- `estimate.priorYearAdjusted` set to `true` exits 1 with `FEATURE_UNSUPPORTED` and subject `estimate.priorYearAdjusted`, before the engine starts. A missing `estimate.priorYearAdjusted` exits 1 with `FACTS_MISSING`. When it is `false`, the engine request does not carry it.
- A refusal exits 1 with one JSON object on stderr, `refused` `true`, `provenance.expected` holding the pin, and no `provenance.observed`. A fault exits 1 with `refused` `false` and no figure. `RESULT_MISMATCH` is that fault when the answer's target or date is missing or differs from the request, and the message carries no figure. A needed fact marked `default` on the balance-due answer, or on the required-payment answer, exits 1 with `FACTS_DEFAULTED` and no figure.
- Colorado, in any case and with surrounding space, exits 1 with `COLORADO` before the engine starts. Any other jurisdiction string exits 1 with `JURISDICTION_UNSUPPORTED`.
- An unknown option is refused by name before any install, any read, and any start. A relative `--facts` is refused by name. `--facts --install` is not consent.
- The child environment the tool sets is `OPENTAX_TELEMETRY=0` and `DO_NOT_TRACK=1`, and the parent's environment is not passed to the child. The only argument is `bundle/index.js`.
- No run writes a fact to a file. The install writes `node_modules/` in this tool's directory, npm's cache outside the plugin, and, when the flag or `WISER_ALLOW_INSTALL=1` authorised it, `.wiser-consent` at the plugin root.
