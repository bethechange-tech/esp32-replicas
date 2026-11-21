# esp32-replicas

Emulated copies ("replicas") of four ESP32 boards. A replica boots real firmware images,
unchanged, and its tests show that the image boots, draws its screen, joins Wi-Fi, reaches an
MQTT broker over TLS and hears BLE advertisers.

The code is TypeScript. The emulation core is [esp32sim](https://github.com/mikroverk/esp32sim)
(Rust, MIT), vendored and run as WebAssembly; see `NOTICE.md`.

> Status: the repository rules, guards, public files and the engine (esp32sim as WebAssembly, driven
> from TypeScript) are in place. The boards arrive stage by stage; `docs/design.md` is the design.

## The boards

| Id | Board |
| --- | --- |
| `small-screen` | Waveshare ESP32-S3-LCD-1.69, without touch |
| `small-screen-touch` | Waveshare ESP32-S3-Touch-LCD-1.69, with touch |
| `panel-7` | Elecrow CrowPanel Advance 7.0 |
| `headless` | A classic ESP32 DevKit with its wired attachments |

## Scope

Replicas of these four boards, and nothing else. Other boards, other chips and bus-level
hardware work are out of scope. Connecting to a battery over GATT is not part of version 1.

## Quick start

You need Node 24 and pnpm. Rust is needed only to rebuild the engine, and Docker only to build
the sample firmware.

```
pnpm install
pnpm check
```

`pnpm check` runs lint, the type check and every test, including the guards that enforce the
rules in `AGENTS.md`.

## The engine

```
pnpm fetch:roms      # the mask ROMs (Apache-2.0), into build/roms, never committed
pnpm engine:build    # build/esp32sim.wasm, with the Rust toolchain pinned in engine.lock
pnpm engine:test     # esp32sim's own tests for the crates used, and its hello_world goldens
```

Tests that need the built engine and the ROMs are skipped in a checkout that has not built
them; CI always builds them.

## Bring your own image

You run your own `factory.bin` on a replica (the `small-screen` and `small-screen-touch` boards so far); `--seconds` is the emulated time to run, default 20:

```
pnpm replica run --board small-screen --image ./factory.bin --wifi ssid=lab,psk=secret \
     --map broker.lab.test=local
```

Nothing about your image leaves your machine. A name your image dials is answered only when
you map it with `--map`.

## Contributing and security

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SECURITY.md`.
