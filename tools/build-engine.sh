#!/bin/sh
# Build the engine's WebAssembly module with the toolchain engine.lock pins.
#   tools/build-engine.sh          -> build/esp32sim.wasm
# Needs Rust (rustup) and the wasm32-unknown-unknown target. Contributors need it only to rebuild the engine.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENGINE="$ROOT/third_party/esp32sim"
WANT=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).toolchain.rust)' "$ROOT/engine.lock")
TARGET=wasm32-unknown-unknown

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
HAVE=$(rustc --version | cut -d' ' -f2)
[ "$HAVE" = "$WANT" ] || { echo "engine.lock pins Rust $WANT and rustc is $HAVE" >&2; exit 1; }
rustup target list --installed | grep -qx "$TARGET" || { echo "missing target: rustup target add $TARGET" >&2; exit 1; }

CARGO_TARGET_DIR="$ROOT/build/engine"
export CARGO_TARGET_DIR
cd "$ENGINE"
. ./tools/wasm-rustflags.sh
cargo build --release --target "$TARGET" -p esp32sim-wasm
cp "$CARGO_TARGET_DIR/$TARGET/release/esp32sim_wasm.wasm" "$ROOT/build/esp32sim.wasm"
ls -l "$ROOT/build/esp32sim.wasm"
