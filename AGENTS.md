---
root: finance
layout: 1
---

# Finance

A WISER domain plugin. This file is this root's constitution. The chain starts here: load it before the first read or write under this root.

A WISER plugin for finance work at a company of any kind: tax, accounting, venture finance, and pro forma modelling. No skills or experts have been built yet; an expert bench for that work, with skills under each expert, is the first planned.

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

This plugin loads alongside `wiser` and may assume it is present. It references `wiser` primitives rather than duplicating them. Copying a `wiser` writing, playbook, or connecting primitive into this tree to remove the dependency is a defect.

## Layout

This root's layout is governed by `wiser/standards/plugin-root.md`. That standard's C1 owns the `layout:` stamp: the current tree version, a bare nonnegative integer. `wiser/skills/Onboard Plugin Root/` writes it last, only once every applicable obligation other than the stamp itself scores present or N/A. A stamp written before that would advertise a conformance nothing had earned, which is why an unstamped tree reads as not current rather than as clean.

## Handover

Stood up 2026-09-18 by `wiser/skills/Onboard Plugin Root/`. Each line is owed to a person and names what closes it. Strike a line when its boundary closes; when the last line goes, delete this section.

- The archive of the placeholder this tree replaced: owed (the operator; the placeholder's `AGENTS.md` and `README.md` were copied outside this root before it was produced, and the stand-up report names exactly where. Nothing inside this root can reach them, so keeping or discarding them is a person's)
