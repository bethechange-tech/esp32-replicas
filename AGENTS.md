# Engineering rules

Rules for any person or AI assistant working in this repository. Follow them without being
asked. If a request conflicts with a rule here, say so before writing code.

Each rule names the guard that enforces it. A guard is a test under `test/guards/` that reads the
code through the TypeScript compiler API, not by searching text. A rule marked "For review" has
no guard yet, and a reviewer holds it. Never loosen a guard to make a change pass: fix the code.

## Layers and structure

### Dependency inversion and composition roots

Rule: §1

Every class that does I/O, holds state or could be swapped is declared as a port first and
depended on only through it. Dependencies arrive through the constructor and are stored as
`readonly` fields. Concrete classes are built only in a composition root:
`packages/cli/src/composition.ts` and `packages/web/src/worker-composition.ts`. No singletons, no
service locators. Module-level `let` and `var` and objects of functions are refused by the
classes-only guard; a mutable object or collection held in a module-level `const` is for review.
A class may build itself in a named constructor (`SmallScreenBoard.withTouch`).

Guard: `test/guards/only-roots-construct.test.ts` fails on a `new` of an exported concrete class
outside a root. It does not see a class built through a computed name.
An exception class is a value built where it is thrown, not a collaborator: each one is pinned by
exact file and name in `test/guards/support/sanctions.ts`, and a sanction that matches nothing is an
offence.

### Layers point inward

Rule: §2

A layer imports only the layers beneath it:

```
core      domain types and ports; imports nothing else (no node:*, no packages)
devices   device models; import core only
boards    board replicas; import core and devices
adapters  one directory per technology; import core (and devices); never each other
roots     the composition roots; may import everything
```

Guard: `test/guards/layers-point-inward.test.ts`.

### Ports and adapters

Rule: §3

A transport or technology is imported only inside its adapter directory: `node:net`, `node:tls`
and the MQTT broker library in `packages/network/src/adapters/node/`, `WebAssembly` in
`packages/engine/src/adapters/wasm/`, and `fetch` in `packages/firmware/src/adapters/download/`.
Child processes are used by build scripts only. Adapters emit core types only, and drop malformed
input before it reaches the core.

Guard: `test/guards/transport-confined.test.ts`. It reads imports, `import()`, `require` and the
uses of `WebAssembly` and `fetch` it knows; a name built from a string is for review.

### Rules live in TypeScript

Rule: §9

Rules and behaviour live in TypeScript, not in the vendored Rust. The Rust seam in the engine
stays a generic bridge that forwards board events to the host and holds no knowledge of any
board. A board fact or board behaviour in the Rust is a defect.

Guard: `test/guards/vendored-tree-matches-the-lock.test.ts` reads `engine.lock` and fails on a
vendored file that differs from upstream's SHA-256 unless the lock lists it under `seam` with its
sealed content, on a file the lock does not name, and on a file missing. The seam is
`wasm/src/host_board.rs` (added) and `wasm/src/lib.rs` (modified). A board fact or board behaviour
in the Rust is still for review.

### Imports are declared

Rule: §10

Every import in a package is declared in that package's `package.json`. Hoisting is not a
dependency.

Guard: `test/guards/layers-point-inward.test.ts`.

### No product or vendor names

Rule: §14

No exported identifier and no adapter directory is named for a product, vendor or library
(Waveshare, Elecrow, CrowPanel, Espressif, ESPHome, Mosquitto, Aedes and the like). Protocols,
standards and chip families are allowed (`Mqtt`, `Http`, `I2c`, `Esp32s3`). Device classes keep
the part number (`Cst816`, `Ina226`, `Gt911`), because it names the register protocol. Vendor
names appear only in `docs/boards.md` and in the facts' `model` fields. The interface takes the
plain name, with no `I` prefix.

Guard: `test/guards/no-product-names.test.ts`.

## How code is shaped

### Classes only

Rule: §5

Behaviour lives in classes. A stateless helper is a static method on a class with a private
constructor. No top-level function, no function assigned to a module-level `const`, no
module-level `let` or `var`, and no `const` object of functions, except where a framework requires
one, pinned by exact
name in `test/guards/support/sanctions.ts`.

Guard: `test/guards/classes-only.test.ts`.

### Two arguments at most

Rule: §5

Never more than two parameters to any function, method or constructor. Three or more values
become one object with a field per value. No flag arguments: two paths are two methods or two
classes.

Guard: `test/guards/two-arguments-at-most.test.ts`.

### One configuration reader

Rule: §5

Configuration is read once, in the entry, by one `ConfigurationReader` class, in
`packages/cli/src/main.ts`, `packages/cli/src/configuration-reader.ts` or
`packages/web/src/worker-composition.ts`. Nothing else touches `process.env`, and a class of
that name in any other file does not count.

Guard: `test/guards/one-configuration-reader.test.ts`.

### Style

Rule: §5

No `any`. No non-null assertion (lint bans it). Early returns over
nesting. No magic numbers: a number is a named constant, or a fact in `facts/boards.json`, or
data asserted by a test. No dead or commented-out code. Few comments: the code explains the
logic, and a comment says only what the code cannot (a reason, a constraint).

Enforced by lint (`eslint.config.js`: no `any`, no non-null assertion, at most two parameters,
no `I` prefix). Bare numbers in board and device files are caught by
`test/guards/facts-have-public-sources.test.ts`; elsewhere, for review.

### Decimal maths for the analogue

Rule: §6

Every unit conversion for a simulated quantity (volts to register values, divider ratios,
currents) uses decimal.js through one arithmetic class per package. A number becomes a JS number
only at a named boundary, such as the register write.

For review (the devices land in later stages, and the guard arrives with them).

### For a unit, the declaration wins

Rule: §8

A field name is not a unit. Find the declaration that stores the number, and cite it. Bounds are
data in `packages/core/src/units.ts`, and `packages/core/src/units.test.ts` asserts the numbers.

For review.

## Facts

### One source of truth

Rule: §7

If the same fact exists in two places it will diverge. Every pin, bus, address, size and
orientation is in `facts/boards.json`, each fact with a public https source and, for a number,
its unit. A board class is built from those facts and holds no number but 0 and 1, named
constant or not; a device class may name its register constants. Where a duplicate is
unavoidable, assert it equal by identity.

Guard: `test/guards/facts-have-public-sources.test.ts`. It reads the facts file only once the
file exists (the first board adds it).

## Testing

### Testing

Rule: §4

Every port has an in-memory fake. Where a fake and a real adapter both exist, one shared contract
suite runs against both. Guards check each occurrence, not each file, and each one is seen red on
a deliberate break made in a scratch copy of the tree, never in a tracked file. A break that
changes nothing the guard reads proves nothing, so every guard test asserts what it read.
A timing-sensitive test needs three clean runs before any verdict. A refusal is asserted by name,
never inferred from something not appearing. A flaky test is made deterministic, never retried.
A failing test is fixed, and deleted only if what it tests no longer exists.

For review: `test/guards/*.test.ts` each carry their own breaks-on cases, and the contract suites
arrive with the engine.

## Workflow

### What already works keeps working

Rule: §12

A change to something that works is backwards compatible. New behaviour is added beside the old.
Breaking a CLI option, the facts schema or a package's public API is a decision, with a version
bump.

For review.

### Workflow and acceptance criteria

Rule: §13

A plan comes first: the files it changes and creates, the architecture, the agents and the files
each one owns, the cost, and acceptance criteria that each name the test that proves them. One
builder is the default. An independent reviewer reviews, and only the reviewer commits. Nothing
is pushed, published or deployed without the owner's go-ahead. Before saying a job is done,
reread the acceptance criteria; a criterion with no test is said out loud to be unverified.

For review.

### No modes and no feature flags

Rule: §11

One code path. A feature that ships is on. CLI options such as `--board` and `--map` are inputs,
not switches.

For review.

## Open source

### Nothing private

Nothing private is in the tree: no secret, key, token, tracked `.env*` file, certificate or key
file, absolute home or volume path, IPv4 address outside the documentation and loopback ranges
(and the emulator's 10.0.2.0/24), email address, or private host name. Private host names and key
prefixes are kept as SHA-256 hashes in an untracked, git-ignored `.private-hashes` file at the
repository root (one digest per line), never in the tree, because a hash of a guessable name still
names it; the tracked list in `test/guards/support/forbidden-hashes.ts` is empty. A host matches
by its name and sub-domains, a key prefix matches any
token that starts with it. Add one with `pnpm guard:hash <name>`.
Vendored files that equal upstream's by
`engine.lock` are public by construction and are not read; a vendored file that differs from the
lock, and every seam file, is read like any other. A file over 2 MB or holding a NUL byte
is not scanned: the guard reports it as skipped, never as read, and the test requires none.
A hashed key prefix of fewer than 4 characters is not matched. Without the file the guard
enforces every other pattern but no hashed name, so CI is as strong as the maintainers' copy
only on their machines. Board facts come from public sources only.
Tests use local fakes and per-run certificates generated in memory.

Guard: `test/guards/nothing-private.test.ts`.

### Public project files

`LICENSE`, `NOTICE.md`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, the
issue and pull request templates and `.github/workflows/ci.yml` exist and say what they must.
CI has `permissions: contents: read`, uses no secrets, and pins every action by commit SHA.

Guard: `test/guards/public-project-files.test.ts`.

### This file

Every guard in `test/guards/` is named here, every rule here names a guard or says it is for
review, and every guard named here exists.

Guard: `test/guards/agents-names-real-guards.test.ts`.

## Rules that do not apply

This repository has no database, API, tenants, payments, alerts, exports or deploys, and takes
only public npm and crates dependencies. Rules about those do not apply.
