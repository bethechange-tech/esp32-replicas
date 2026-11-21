# Contributing

Thank you for helping. Read `AGENTS.md` first: it holds the rules, and each one names the guard
that enforces it.

## Scope

This project replicates four boards: `small-screen`, `small-screen-touch`, `panel-7` and
`headless`. A pull request for another board or chip is out of scope.

## Setup

- Node 24 (see `.nvmrc`) and pnpm.
- Rust, only to rebuild the engine.
- Docker, only to build the sample firmware.

```
pnpm install
```

## The checks CI runs

```
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm check` runs all three. Everything must pass with zero failures. A failing test is fixed,
never loosened or retried.

## Goldens

Screen goldens are reviewed pictures kept in `test/goldens/`. They are bit-identical and change
only on purpose: a pull request that changes one says why, and a reviewer opens the picture.

## Rules in short

Classes only, constructor injection, ports and adapters, at most two arguments, no product names
in code, and nothing private in the tree. The long form, with the guard for each rule, is in
`AGENTS.md`. Never loosen a guard to make a change pass: fix the code.

## Pull requests

Use the template. Say which checks you ran, and if a golden changed, why.
