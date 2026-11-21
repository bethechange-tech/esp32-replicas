#!/bin/sh
# Upstream's own test suite for the crates the replicas use, inside the vendored engine, plus its S3 and
# classic hello_world goldens.
#   tools/engine-test.sh        (needs Rust, and the mask ROMs from `pnpm fetch:roms` in build/roms)
# The RISC-V chip crates (esp32c3, esp32c6, esp32p4, esp32s31, riscv-rv32) are linked into the module but are
# out of scope for the replicas, and their suites need firmware images that are not vendored; they are not run.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
CARGO_TARGET_DIR="$ROOT/build/engine-tests"
ESP32SIM_ROM_DIR="$ROOT/build/roms"
export CARGO_TARGET_DIR ESP32SIM_ROM_DIR
cd "$ROOT/third_party/esp32sim"
cargo test --no-fail-fast -p emu-core -p esp-periph -p esp-soc -p xtensa-lx7 -p esp32s3 -p esp32 -p esp32sim-wasm
cargo test -p esp32sim --test goldens -- --include-ignored --exact hello_world_s3 hello_world_classic
