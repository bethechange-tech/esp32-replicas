#!/bin/sh
# Builds the sample firmware in sample-firmware/ with the ESPHome container pinned by digest in
# sample-firmware/samples.lock, on the platform that lock names (one canonical binary, emulated where the host differs), and writes factory.bin and firmware.elf under build/samples/<id>/.
#   tools/build-samples.sh [small-screen]
# Needs Docker. The binaries are never committed; samples.lock pins their SHA-256.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SAMPLES="$ROOT/sample-firmware"
OUT="$ROOT/build/samples"
WORK="$ROOT/build/esphome-work"
lock_field() {
  node -e 'process.stdout.write(String(process.argv[2].split(".").reduce((node, key) => node[key], JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")))))' "$SAMPLES/samples.lock" "$1"
}
IMAGE=$(lock_field esphome.image)
PLATFORM=$(lock_field esphome.platform)
CACHE="$ROOT/build/esphome-cache/$(echo "$PLATFORM" | tr / -)"
FIXED_EPOCH=1780000000
IDS=${1:-small-screen}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi
}

mkdir -p "$OUT" "$CACHE"
for id in $IDS; do
  mkdir -p "$WORK"
  run=$(mktemp -d "$WORK/$id.XXXXXX")
  cp -R "$SAMPLES/$id.yaml" "$SAMPLES/common" "$SAMPLES/partitions.csv" "$run/"
  docker run --rm --platform "$PLATFORM" -e SOURCE_DATE_EPOCH="$FIXED_EPOCH" -e PYTHONPATH=/reproducible -v "$ROOT/tools/reproducible-build:/reproducible:ro" -v "$run:/config" -v "$CACHE:/cache" "$IMAGE" compile "$id.yaml"
  built="$run/.esphome/build"
  mkdir -p "$OUT/$id"
  cp "$(find "$built" -name firmware.factory.bin | head -1)" "$OUT/$id/factory.bin"
  cp "$(find "$built" -name firmware.elf | head -1)" "$OUT/$id/firmware.elf"
  docker run --rm --platform "$PLATFORM" -v "$WORK:/work" --entrypoint rm "$IMAGE" -r -f "/work/$(basename "$run")"
  echo "$id: $(sha256_of "$OUT/$id/factory.bin") factory.bin"
  echo "$id: $(sha256_of "$OUT/$id/firmware.elf") firmware.elf"
done
