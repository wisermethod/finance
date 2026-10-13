---
root: finance
layout: 1
---

# Finance

A WISER domain plugin. This file is this root's constitution. The chain starts here: load it before the first read or write under this root.

A WISER plugin for finance work at a company of any kind: tax, accounting, venture finance, and pro forma modelling. Its first slice is tax: the expert Tax Counselor, its skills Tax Intake and Estimated Tax, and the tool Tax Engine, which compute a person's federal quarterly estimated tax for 2025 and 2026. Accounting, venture finance and pro forma modelling are not built yet.

## What this root is

An authoring tree, not a working folder. Nothing here is anyone's work product; everything here is the capability that such work uses. Output belongs in the working folder a session attaches, never in this root.

This plugin carries no user-root `type:`, no Provides block, and no Onboarding keys.

## Composition

This plugin loads alongside `wiser` and may assume it is present. It references `wiser` primitives and standards rather than duplicating them, per `wiser/AGENTS.md` Precedence and routing. Copying a `wiser` primitive into this tree to remove the dependency is the defect; referencing one is the pattern. Nothing in `wiser` references this plugin.

## Write mode

In use this root is read-only. Nothing is written under this root during a session that uses it, and output lands in the working folder the session attached, in the directories that folder's own `AGENTS.md` declares. Authoring this root is separate work, entered by the operator's authorization for a named phase and a named target, per `wiser/AGENTS.md` Workspace Model. A Playbook, a ledger row or the operator's own instruction may record that authorization; none of them is the grant.

A session that has loaded this constitution and the base plugin's refuses ordinary writes to both.

What may be written here is governed by this heading and by `wiser/AGENTS.md` Writes, Irreversibles, Workspace Model, and Working under this root.

## Families

| Directory | Holds |
|-----------|-------|
| `skills/` | This plugin's skills |
| `experts/` | This plugin's experts |
| `tools/` | This plugin's tools |
| `connectors/` | This plugin's connectors |

Family placement follows `wiser/standards/primitives.md`. This plugin ships no `gateway/`; the base plugin alone ships one. Where this plugin ships `connectors/`, those connectors load through that gateway's repeated `--connectors` flag, per `wiser/gateway/SETUP.md`.

Each family directory carries its own `AGENTS.md` index. An empty index is still an index.

## Standing constraint

Whatever this plugin becomes, it does not replace a licensed CPA, enrolled agent, or other tax professional, and it does not hold itself out as one. That constraint is decided; it binds any later design and is not open for a build session to relax.

## Third-party engines

A tool here may drive a third-party engine that a person installs, as Tax Engine drives `@invaro/opentax`. Four rules bind every such tool:

- **Never vendor.** This repository ships the manifest and lockfile that name an engine, never the engine's code. The person's own consented install fetches it.
- **Never derive.** No file here copies, transcribes or adapts an engine's code. A tool reaches an engine only as a separate process.
- **Never host a modified engine.** No tool here runs a modified copy of an engine, and nothing here serves an engine to anyone over a network.
- **Still attribute.** Each such tool names its engine, the version, the licence and the source in a `NOTICE.md` beside its `TOOL.md`.

These rules are decided; they bind any later design and are not open for a build session to relax.

## Layout

This root's layout is governed by `wiser/standards/plugin-root.md`. That standard's C1 owns the `layout:` stamp: the current tree version, a bare nonnegative integer. `wiser/skills/Onboard Plugin Root/` writes it last, only once every applicable obligation other than the stamp itself scores present or N/A. A stamp written before that would advertise a conformance nothing had earned, which is why an unstamped tree reads as not current rather than as clean.
