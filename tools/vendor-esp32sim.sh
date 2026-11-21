#!/bin/sh
# Copy the pinned subset of esp32sim into third_party/esp32sim and write engine.lock.
#   tools/vendor-esp32sim.sh <commit-sha>
# A re-vendor is a reviewed job of its own: it overwrites the subset (so the seam files too), so run it on a clean tree,
# then re-apply the seam (the files listed under "seam" in engine.lock) and read the diff.
set -eu
[ $# -eq 1 ] || { echo "usage: $0 <commit-sha>" >&2; exit 2; }
SHA=$1
REPOSITORY=https://github.com/mikroverk/esp32sim.git
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$ROOT/third_party/esp32sim"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$REPOSITORY" "$WORK/src"
git -C "$WORK/src" checkout --quiet "$SHA"
FULL=$(git -C "$WORK/src" rev-parse HEAD)

CRATES="emu-core esp-periph esp-soc xtensa-lx7 esp32s3 esp32 esp32c3 esp32c6 esp32p4 esp32s31 riscv-rv32 wasm wasm-jit cli tests"
FILES="Cargo.toml Cargo.lock LICENSE tools/wasm-rustflags.sh tools/fetch-rom-elfs.sh
web/wasm/fw/public/hello-bootloader.bin web/wasm/fw/public/hello-ptable.bin web/wasm/fw/public/hello_world.bin
web/wasm/fw/public/classic-hello-bootloader.bin web/wasm/fw/public/classic-hello-ptable.bin web/wasm/fw/public/classic-hello_world.bin
web/wasm/fw/public/classic-hello-NOTICE.txt"

mkdir -p "$WORK/pristine"
for crate in $CRATES; do
  mkdir -p "$WORK/pristine/$crate"
  cp -R "$WORK/src/$crate/." "$WORK/pristine/$crate/"
done
for file in $FILES; do
  mkdir -p "$WORK/pristine/$(dirname "$file")"
  cp "$WORK/src/$file" "$WORK/pristine/$file"
done
find "$WORK/pristine" -name .DS_Store -delete

node "$ROOT/test/guards/support/vendor-lock.ts" write "$WORK/pristine" "$ROOT/engine.lock" "$FULL"

mkdir -p "$DEST"
cp -R "$WORK/pristine/." "$DEST/"
echo "vendored esp32sim $FULL into third_party/esp32sim; re-apply the seam listed in engine.lock"
