# Tools

Deterministic operations that skills and experts call; `wiser/standards/primitives.md` owns the type. Running one is `wiser/tools/RUNNING.md`; the contract is `wiser/standards/script-contract.md`. The directory is flat, and the index below is grouped by category.

## Installing

A tool ships its manifest and never its packages. Tax Engine installs `@invaro/opentax` only when the person consents: `--install` on that run is the answer, and `WISER_ALLOW_INSTALL=1` is the same answer for an unattended run. A later run whose `.wiser-consent` marker matches this copy does not ask (`wiser/tools/RUNNING.md`). The package lands in the tool's own directory, per copy of the plugin, so the plugin directory has to be writable. An install writes nothing this repository ships.

**Hosts an install reaches.** `registry.npmjs.org`.

## Everything a tool writes, and where

The one list; a tool's pages point here.

| What | Where | Which tools |
|------|-------|-------------|
| Plugin consent marker | `.wiser-consent` at the plugin root | Tax Engine, when `--install` or `WISER_ALLOW_INSTALL=1` authorises that install |
| Node packages | `node_modules/` in Tax Engine's directory | Tax Engine |
| npm's cache and logs | npm's own cache and logs, `~/.npm` by default, outside this plugin | Tax Engine |

The engine Tax Engine starts writes nothing under the home directory, because the tool starts it opted out, as `tools/Tax Engine/TOOL.md` states. No run writes a fact to a file, and the tool writes no output file. `help` writes nothing. A `check` without `--install` does not install and does not write the consent marker.

<!-- generated:index -->

### Tax

| Tool | Description |
|------|-------------|
| `Tax Engine/TOOL.md` | One JSON object with a federal figure from stated facts, the total tax or a quarterly estimate under the regular method, or a check of the pinned engine |

<!-- /generated:index -->
