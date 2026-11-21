# Notices

This project is MIT licensed (see `LICENSE`). It builds on the work below.

## esp32sim

The emulation engine is [esp32sim](https://github.com/mikroverk/esp32sim), MIT licensed,
copyright (c) 2026 Joakim Eriksson, Alice and Mattia Fiumara. The vendored subset keeps its
`LICENSE` byte for byte, with the commit it was taken from recorded in `engine.lock`.

One data file in it, the ESP-IDF ADC calibration in `esp-periph/src/sar_adc.rs`, is Apache-2.0
and keeps its `LICENSE-ADC`.

The vendored subset under `third_party/esp32sim/` is upstream's files, byte for byte, except the two seam
files listed in `engine.lock`: `wasm/src/host_board.rs` is added and `wasm/src/lib.rs` is modified (a generic
host board and its constructor). Upstream's own tests, goldens and its hello_world images
(`web/wasm/fw/public/`, upstream's own code, with its `classic-hello-NOTICE.txt`) are included for the tests;
the binaries contain ESP-IDF, with its licences listed upstream.

`packages/engine/src/adapters/wasm/jit-host.ts` is a TypeScript port of esp32sim's `web/wasm/jit.mjs` (MIT,
same copyright holders as above).

## Espressif ROM images

The ROM ELF files some tests need are Apache-2.0, published by Espressif. They are downloaded
by a script, never committed.

## ESPHome

The sample firmware definitions in `sample-firmware/` are MIT, like this project. The firmware
built from them contains ESPHome's runtime, which is GPLv3. Built images are release assets,
never committed, and each release ships a notice that points to the sample sources and the
pinned ESPHome version they were built with.
