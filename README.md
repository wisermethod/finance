# Finance

A WISER plugin for a person's federal quarterly estimated tax for 2025 or 2026, computed by a locally installed engine for a filer inside the profile Tax Intake asks about. Colorado and every other state, every other year, and the annualized installment method are refused by name. It ships the expert Tax Counselor, the skills Tax Intake and Estimated Tax, and the tool Tax Engine. Accounting, venture finance, and pro forma modelling are not built yet.

This plugin does not replace a licensed CPA, enrolled agent, or other tax professional, and it does not hold itself out as one.

Tax Engine installs `@invaro/opentax` only with the person's consent, and this repository redistributes no copy of it. See `tools/Tax Engine/NOTICE.md`.

## Install

Install Wiser first, by its [Install steps](https://github.com/wisermethod/wiser#install): this plugin loads beside it. Then add this plugin in the same app:

- **Claude Cowork.** Open Customize, then Plugins, then Add marketplace. Give it `https://github.com/wisermethod/finance`, and install `finance`. Then turn on Sync automatically for this marketplace, as Wiser's steps do for theirs.
- **Claude Code.** Run `claude plugin marketplace add wisermethod/finance`, then `claude plugin install finance@wiser-method-finance`, and start Claude Code in your working folder.
- **Codex.** Add `wisermethod/finance` as a marketplace and install `finance`.
- **ChatGPT for desktop.** Add `wisermethod/finance` as a marketplace and install `finance`.
- **Grok.** Run `grok plugin marketplace add wisermethod/finance`, then `grok plugin install finance --trust`.
- **Cursor.** Add your clone of this repository as a workspace root beside your clone of Wiser and your working folder.

Work lands in the working folder you attach, never in this repository.

## Support

Email support@wisermemory.com.
