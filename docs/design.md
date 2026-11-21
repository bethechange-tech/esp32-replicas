# ESP32 board replicas: the design

This is the public design of the project. It is written for the public: it names no private host, path, key or customer, and anything a maintainer holds privately stays out of this repository by rule (§7).

## 0. What we are building

**The job.** Emulated copies ("replicas") of four ESP32 boards used for battery-monitor devices, and nothing else:

- the Waveshare 1.69" screen board, without and with touch;
- the Elecrow CrowPanel 7" panel;
- a classic ESP32 DevKit with its wired attachments.

The replicas boot real ESP32 firmware images, unchanged, and their tests prove five things:

1. the image boots;
2. it draws its screen;
3. it joins Wi-Fi;
4. it reaches an MQTT broker over TLS;
5. it hears BLE advertisers.

**Four decisions shape it:**

| Decision | Consequence |
| --- | --- |
| A repository of its own | Any project can use the replicas as an outside tool (§10) |
| **Written in TypeScript** | All of our code is TypeScript; §2 settles how the Rust example is used |
| **Strict coding rules, enforced** | It ships its own `AGENTS.md`; guards enforce the rules (§6) |
| **Open source** | MIT licence; nothing private in it; public sample firmware for the tests; users bring their own images (§7) |

**The example we follow** is [mikroverk/esp32sim](https://github.com/mikroverk/esp32sim) (MIT, Rust), read at commit `d043ff1dd3e53aca18a23f4f2b18bfb038a57667` (17 Nov 2026). We read it but did not build or run it. Everything below is marked **observed** (read in a file or measured from bytes) or **inferred** (reasoned, not yet run).

---

## 1. What esp32sim gives us (observed in its source and docs)

### 1.1 What it can do

- **Chips.**
  - **ESP32-S3**: rated "mature" upstream, with a block cache, an AArch64 JIT natively, and a WebAssembly JIT in the browser.
  - **Classic ESP32 (LX6)**: rated "early". It boots the rev-3 mask ROM.
  - The C3, C6, P4 and S31 are out of scope here.
- **Boot.** The real chain runs: mask ROM (Espressif's ROM ELFs, Apache-2.0, downloaded and never committed), then the second-stage bootloader, FreeRTOS and the unchanged app.
  - **A whole flash image loads at offset 0** (`--flash-image`, or wasm `esp32sim_load` kind 5).
  - That is the shape of an ESPHome `factory.bin`. The S3 bootloader sits at `0x0`, the classic one at `0x1000`, the partition table at `0x8000` and the app at `0x10000` (observed on real ESPHome images).
- **Displays.**
  - SPI DCS panels: ST7789 and others.
  - The S3's **LCD_CAM parallel-RGB engine** fed by GDMA (used for a 480×480 ST7701S board).
- **Touch.** Models for `Gt911` (address chosen by the board), CST820, FT5x06 and others.
- **Wi-Fi.** The unmodified Espressif Wi-Fi blob joins an open or WPA2-PSK virtual access point on the S3 and on classic. It gets DHCP, DNS and SNTP on a virtual subnet: the station at `10.0.2.15` behind gateway `10.0.2.2`. TLS runs on the emulated AES, SHA and RSA blocks.
- **Bluetooth LE.** An HCI-level virtual controller on the S3 and classic.
  - **It needs the application ELF**, with unstripped controller symbols.
  - It gives one unencrypted link, ATT MTU 23 and no pairing.
  - `ble_nearby` puts up to 32 scannable, non-connectable advertisers around the guest.
  - Bluedroid on ESP-IDF 5.5.4 is validated. IDF 4.4 Bluedroid is refused.
- **UART, GPIO, ADC.**
  - **UART.** A board can take a UART's TX bytes and inject RX bytes on a GPIO at a baud rate (S3).
  - **GPIO and touch.** Buttons and GPIO levels come from the page protocol (`btn`, `gpio`, `touch`).
  - **ADC.** Inputs are given in volts or counts by an action script (`adc <gpio> <V>`).
- **Flash and PSRAM.**
  - **Flash.** The SPI flash controller programs and erases, and NVS works.
  - **PSRAM.** Octal on the S3 (up to 64 MB); 4 MB quad or none on classic.
- **How a board is defined.** One Rust `impl BoardModel`. It receives GPIO edges, SPI transactions, UART bytes and LCD frames. It lists its I2C devices as `(bus, address, device)` and returns its display, LEDs and a report.
  - Boards are registered in a closed `make_board(name)` match in each chip crate.
  - The "panel" browser demo (`run.html?wasm&fw=panel`) is the `waveshare-lcd4b` board, booted from a JSON manifest.
- **Front ends.**
  - A native CLI, plus a **WebAssembly build that runs in a browser Web Worker and under Node** (`tools/wasm-test.mjs`).
  - The wasm module is a plain C ABI: `esp32sim_new`, `load`, `load_at`, `wifi`, `boot`, `run(cycles, unix_ms)`, `in_text`/`in_bin`, `out_*`, `ble_virtual`, `ble_nearby`, `netmon`, and more. It imports only `host_log`.
  - **The browser has no sockets**, so the module offers **"NAT through the page"** (`esp32sim_nat_relay`, `nat_take`, `nat_event`):
    - the guest's TCP and UDP flows past the gateway become records the host takes after each run slice;
    - the host answers with events (connected, data, EOF, reset);
    - the host can also **resolve the guest's DNS queries itself** (`RESOLVE` records).
- **Speed, as upstream reports it** (one machine, M-series Mac):
  - in Chrome, an LVGL panel firmware on the S3 runs at **real time, about 62 M instructions per second**;
  - an LVGL compass on another chip reaches 460–540 M instructions per second;
  - the browser build compiles hot Xtensa blocks into extra WebAssembly modules.
  - **Natively** the S3 runs `hello_world` about 30× faster than real time.
- **Upstream's house rules worth keeping.**
  - Clippy runs with `-D warnings`.
  - Goldens are bit-identical and regenerated only on purpose.
  - Register values cite their IDF header.
  - Nothing the guest controls may panic the emulator.
  - A test needing a developer-only input is `#[ignore]` and named `external_*`.
- **Size and licence.**
  - The tree is 91 MB, mostly docs and demo firmware.
  - The Rust that matters here is about **62,000 lines**: `xtensa-lx7` 14.9k, `esp-soc` 16.3k, `esp-periph` 11.4k, `esp32` 10.0k, `esp32s3` 7.9k, `wasm` 2.9k, the rest small.
  - **MIT**, © 2026 Joakim Eriksson, Alice and Mattia Fiumara.
  - It carries one Apache-2.0 data file: ESP-IDF ADC calibration in `esp-periph/src/sar_adc.rs`, under `esp-periph/LICENSE-ADC`.
- **ESPHome.** Nothing upstream says an ESPHome image has ever run on it. **Ours would be the first, as far as its docs show.**

### 1.2 What it cannot do for us without a change (observed in the code)

- **Out-of-tree boards cannot be added.** `make_board` is a closed `match`, called directly by the CLI and the wasm layer. There is no injection point, and nothing in the module can call out to a board written in another language.
- **Byte-exact console input is unconfirmed.** The page's `key` message carries "bytes exactly as typed" in a JSON string. Whether bytes above `0x7F` arrive unchanged has not been checked. Improv packets need that (§3.4).

---

## 2. The language decision: port it, or drive its WebAssembly from TypeScript

| | (a) Port esp32sim's design to TypeScript | (b) **Drive esp32sim's WebAssembly from a TypeScript host** |
| --- | --- | --- |
| **What is written** | An Xtensa LX6 and LX7 core: windowed registers, loops, FPU, MAC16, exceptions. The cache MMU, flash controller, octal PSRAM, eFuse, RTC, timers, interrupt and GPIO matrices, UART, USB-Serial/JTAG, I2C, GDMA, GP-SPI, LEDC, LCD_CAM, SHA/AES/RSA, the Wi-Fi MAC model, a WPA2 access point, DHCP/DNS/TCP and the BLE VHCI hooks, all in TypeScript: **about 62,000 lines of Rust to re-derive**, then re-validation against upstream's goldens | **Our TypeScript**: the board replicas, every device model, the network bridge, setup, firmware loading, tests and the CLI. **A small Rust seam** inside the vendored engine (§3.2) so boards written in TypeScript plug in |
| **Effort** (inferred) | Months of work before the first ESPHome boot; every upstream fix must be re-ported | The seam is hundreds of lines; the first boot can come in the first stages |
| **Speed** (inferred; none of it measured here) | A pure-TypeScript interpreter has no block-to-WebAssembly compiler unless we write one too. Expect it **well below** the wasm JIT's real-time figure: a boot that takes seconds there could take minutes | **Upstream's measured path**: real time in Chrome for an LVGL S3 panel; under Node it is the same module |
| **Running our `factory.bin` images** | Only once the port is complete and correct; every gap is ours to find | Today's engine, with the same register behaviour upstream validates against silicon |
| **Licence** | A port is a derivative work: MIT notice kept, with attribution in each ported module | The vendored code keeps its `LICENSE` and `LICENSE-ADC` byte for byte; our code is MIT too |
| **Browser demo** | Possible, but slow without the JIT | **Works**: it is upstream's own browser path; our TypeScript host runs in the same Web Worker |
| **Keeping up with upstream** | A manual re-port forever | A pinned re-vendor plus the seam |

**Recommendation: (b).**

- **What is TypeScript.** Every line we write: boards, devices, network, setup, tests, CLI, browser host.
- **The Rust that stays.** esp32sim's core runs unchanged as WebAssembly underneath, apart from one small, generic seam.
- **The seam goes upstream later.** It is a "host board" bridge that any embedder could use, and is offered upstream after v1 (Q2).
- **Where esp32sim stays the reference.** Peripheral behaviour, register citations and its board recipe, which our TypeScript boards mirror device by device.
- **No zero-Rust variant.** Upstream's wasm cannot call out to a board, so boards written in TypeScript need the seam. Keeping boards in Rust would contradict "TypeScript owns the boards".

---

## 3. The design

### 3.1 Layers and packages

The repository is a pnpm workspace in TypeScript strict mode. A layer may only import the layers beneath it.

```
core        domain types and ports; imports nothing else (no node:*, no wasm, no adapters)
devices     device models (register protocols): import core only
boards      board replicas assembled from devices + board facts: import core, devices
adapters    one directory per technology; each imports core (and devices for the engine bridge); adapters never import each other
roots       composition roots: cli (Node) and web (browser worker); the only files that construct concrete classes
```

```
esp32-replicas/                          (repository name: Q11)
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js, vitest.workspace.ts, .nvmrc
├── LICENSE                              MIT (this project)
├── NOTICE.md                            esp32sim (MIT) and its Apache-2.0 ADC data; ESPHome (sample firmware is GPLv3 runtime + MIT YAML); downloaded ROM ELFs (Apache-2.0)
├── README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  AGENTS.md
├── .github/
│   ├── workflows/ci.yml                 public CI, no secrets, `permissions: contents: read`, actions pinned by SHA
│   ├── ISSUE_TEMPLATE/{bug.yml, config.yml}   (config.yml says new boards are out of scope)
│   └── PULL_REQUEST_TEMPLATE.md         checks run, goldens changed and why
├── docs/
│   ├── design.md                        this file
│   ├── boards.md                        per replica: modelled, not modelled, public sources
│   └── planning/                        one plan per later job
├── engine.lock                          esp32sim commit, toolchain, per-file SHA-256 of the vendored tree, the seam's file list
├── third_party/esp32sim/                vendored Rust subset + LICENSE + esp-periph/LICENSE-ADC + the seam commit
├── facts/boards.json                    the board facts (pins, addresses, sizes, orientation, attachments), each with a public https source
├── sample-firmware/                     public ESPHome YAML, one per board, + build script (ESPHome container pinned by digest)
│   ├── small-screen.yaml, small-screen-touch.yaml, panel-7.yaml, headless.yaml, common/*.yaml, partitions.csv
│   └── samples.lock                     the ESPHome version, the image digest and the build platform (linux/amd64), and per sample the SHA-256 of factory.bin and firmware.elf
├── packages/
│   ├── core/src/                        board-facts.ts, run-plan.ts, observation.ts, units.ts, ports/*.ts
│   ├── devices/src/                     dcs-panel.ts, rgb-frame.ts, cst816.ts, gt911.ts, ina226.ts, backlight-helper.ts, power-latch.ts, status-light.ts, line-source.ts
│   ├── boards/src/                      small-screen-board.ts, panel-board.ts, headless-board.ts, board-catalogue.ts
│   ├── engine/src/                      adapters/wasm/{wasm-emulator-engine.ts, host-board-bridge.ts, host-imports.ts, nat-records.ts}
│   ├── network/src/                     adapters/node/{node-socket-network.ts, tls-hello-listener.ts, in-process-mqtt-broker.ts}, adapters/memory/offline-network.ts
│   ├── setup/src/                       improv-serial.ts (the Improv protocol)
│   ├── firmware/src/                    flash-image.ts (validation), sample-firmware-catalogue.ts, user-image-source.ts, test-ca.ts
│   ├── cli/src/                         main.ts, composition.ts, commands/*.ts, configuration-reader.ts
│   └── web/src/                         worker-composition.ts, page.ts (S6)
├── test/                                acceptance/*.test.ts, contracts/*.ts (shared contract suites), fakes/*.ts, guards/*.test.ts, goldens/
└── tools/vendor-esp32sim.sh, build-engine.sh, build-samples.sh
```

### 3.2 The seam in the vendored engine (Rust, generic, one commit)

Each piece sits beside the old path, and upstream's boards behave exactly as before. AC0.3 tests that.

1. **A `host` board.** `esp32sim_new` with board name `host` builds `HostBoard`, an `impl BoardModel` that forwards every board event to **synchronous wasm imports**, in order:
   - `host_board_gpio(edges)` and `host_board_spi(transaction)`, which returns MISO bytes;
   - `host_board_i2c(bus, op)`, covering start, write (returns an ACK), read (returns a byte) and stop;
   - `host_board_uart_tx(byte)` and `host_board_lcd_frame(frame)`.

   Order matters, because a DCS panel needs the D/C level at the moment of each SPI byte, so the calls are synchronous.
2. **Declaring a host board.** `esp32sim_host_board(e, spec_json)` declares which I2C addresses answer on which bus, whether SPI pins and UART pins are routed to the host, and whether LCD frames go to the host. `esp32sim_board_uart_input(e, rx)` queues RX bytes for a pin and baud, as `BoardModel::uart_rx` does natively.
3. **Byte-exact console input.** Added **only if S0 finds that `key` is not byte-exact**: one binary page-message type, "console bytes", for USB-Serial/JTAG and UART0.
4. **Nothing else.** The module's existing exports already cover the rest:
   - whole-image load, Wi-Fi, BLE nearby, the BLE virtual controller with an ELF;
   - action scripts (ADC), the NAT and DNS relay, and network frames (`netmon`).

`tools/vendor-esp32sim.sh <sha>` copies the needed crates into `third_party/esp32sim/`: `emu-core`, `esp-periph`, `esp-soc`, `xtensa-lx7`, `esp32s3`, `esp32`, the other chip crates `wasm` links, `wasm` and `wasm-jit`. It writes `engine.lock`. A guard fails if any vendored file differs from the lock other than the seam's listed files. `tools/build-engine.sh` builds `esp32sim.wasm` with the pinned Rust toolchain (`wasm32-unknown-unknown`). CI builds it every run, cached by the lock's hash. Contributors need Rust only to rebuild the engine.

### 3.3 Ports and adapters (TypeScript)

| Port (in `core/ports`) | Adapter(s) | Role |
| --- | --- | --- |
| `EmulatorEngine` (`create(BoardDeclaration)`, `load(FlashImage)`, `boot()`, `run(Slice)`, `sendInput(Input)`, `takeOutput()`) | `WasmEmulatorEngine` (the module, through `HostBoardBridge`); `ScriptedEmulatorEngine` in `test/fakes` | run firmware; the only place the C ABI is touched |
| `BoardReplica` (receives `GpioEdges`, `SpiTransaction`, `I2cOperation`, `UartByte`, `LcdFrame`; exposes `frame()`, `report()`) | `SmallScreenBoard`, `PanelBoard`, `HeadlessBoard` | the replicas, built from `BoardFacts` and devices |
| `I2cDevice`, `SpiDevice`, `GpioWatcher`, `UartEndpoint`, `Display` | the device models in `devices/` | one register protocol each |
| `GuestNetwork` (answers the module's NAT and DNS records) | `NodeSocketNetwork` (node:net, with a name map to local listeners); `OfflineNetwork` (refuses every flow; the browser and offline tests) | the network behind the virtual access point |
| `TlsPeer` | `TlsHelloListener` (node:tls; records SNI; refuses or completes with a per-run certificate) | the broker end of the TLS checks |
| `MqttPeer` | `InProcessMqttBroker` (a broker library inside its adapter directory, TLS with the per-run CA) | full MQTT session for sample firmware |
| `SetupChannel` | `ImprovSerial` (frames, checksums, `WIFI_SETTINGS`) | the standard wired Wi-Fi setup |
| `FirmwareSource` | `SampleFirmwareCatalogue` (built or downloaded samples, checked against `samples.lock`); `UserImageSource` (a `factory.bin` path the user gives) | where an image comes from |
| `CertificateAuthority` | `TestCa` (node:crypto; a fresh CA and broker certificate per run, in memory, never written to the repository) | trust for the sample firmware |
| `Clock` | `FixedClock` (tests); `WallClock` (the demo) | the `unix_ms` the engine is given |

**Shared contract suites.**

- `EmulatorEngine` is run against `WasmEmulatorEngine` and the scripted fake.
- `GuestNetwork` is run against both of its adapters.
- `FirmwareSource` is run against both of its adapters.

**The composition roots** are `packages/cli/src/composition.ts` and `packages/web/src/worker-composition.ts`.

### 3.4 How a replica is defined

- **Facts are data, with sources.** `facts/boards.json` holds every pin, bus, address, size, orientation flag and attachment, each with a public https `source` (a vendor wiki or demo code, a schematic, or ESPHome's model table at a pinned tag).
  - A board class is constructed **from** those facts and holds no pin literal (guard AC0.9).
  - Units are declared beside each number (§6, rule §8); `core/units.ts` holds the bounds, and a test asserts them.
- **Names by role, never by vendor.**
  - Classes: `SmallScreenBoard` (built by `withoutTouch` and `withTouch`: two constructors, not a flag), `PanelBoard` and `HeadlessBoard`.
  - CLI ids: `small-screen`, `small-screen-touch`, `panel-7` and `headless`.
  - Device classes keep the **part number** (`Cst816`, `Ina226`, `Gt911`), because a part number names the register protocol the device speaks, which upstream does too.
  - Vendor board names appear only in `docs/boards.md` and the facts' `model` fields.
- **Decimal maths for the analogue.** Every unit conversion (volts to INA226 bus and shunt registers, divider ratios, currents) uses decimal.js through one `UnitArithmetic` class per package. Numbers become JS numbers only at a named boundary, the register write.

#### The four boards (public hardware facts)

These are the facts the replicas implement. S0 records each one's public source in `facts/boards.json`. A fact with no public source found is a blocker for that board, not a guess.

**small-screen: Waveshare ESP32-S3-LCD-1.69, V2**

| Item | Value |
| --- | --- |
| Chip, flash, PSRAM | ESP32-S3, 16 MB flash, octal PSRAM at 80 MHz; PSRAM size **8 MB** (N16R8 module; Q5) |
| Display | ST7789V2, 240×280 visible in a 240×320 RAM at row offset 20; mirrored X and Y, colours inverted; SPI: SCLK 6, MOSI 7, CS 5, D/C 4, RST 8 |
| Backlight | PWM on GPIO15 |
| Buttons | BOOT on GPIO0 (active low); PWR on GPIO40 (active low) |
| Power latch | SYS_EN on GPIO41 (V2 boards; V1's pins 35 and 36 belong to octal PSRAM) |
| I2C | SDA 11, SCL 10 |
| Battery sense | ADC on GPIO1 through a 200 kΩ/100 kΩ divider (× 3) |
| Not modelled (unused by the boards' firmware) | QMI8658, PCF85063, buzzer |

**small-screen-touch: Waveshare ESP32-S3-Touch-LCD-1.69, V2**

As small-screen, plus a CST816T touch controller at I2C `0x15`, INT on GPIO14, RST on GPIO13.

**panel-7: Elecrow CrowPanel Advance 7.0, V1.2 or later**

| Item | Value |
| --- | --- |
| Chip, flash, PSRAM | ESP32-S3, 16 MB flash, octal PSRAM (8 MB, Q5) |
| Display | 800×480 parallel RGB565 at PCLK 20 MHz, inverted; DE 42, HSYNC 40, VSYNC 41, PCLK 39; R `7,17,18,3,46`, G `9,10,11,12,13,14`, B `21,47,48,45,38`; porches 4/8/8 (ESPHome `mipi_rgb` model `CROWPANEL-ADVANCE-7`, tag 2026.11.0b4) |
| Touch | GT911 at I2C `0x5D`, on SDA 15, SCL 16, 400 kHz |
| Backlight | a helper MCU at I2C `0x30` that switches on when sent `0x10` |
| Console | UART0 |

**headless: a classic ESP32 DevKit** (`esp32dev`)

| Item | Value |
| --- | --- |
| Chip, flash, PSRAM | ESP32, 4 MB flash, no PSRAM |
| Status LED | GPIO2 |
| Console | UART0 |
| Optional attachments, chosen per run | an INA226 current and voltage monitor on SDA 21 / SCL 22 at `0x40` (0.010 Ω shunt); a 1:1 resistor divider into ADC GPIO36 (× 2) |

**UART line on small-screen.** An optional serial line into RX on GPIO18 at 115200 baud, 8N1, feeds text lines to the firmware.

#### How the replicas are built (inferred, confirmed stage by stage)

- **small-screen.**
  - **Display.** `DcsPanel` in TypeScript, mirroring upstream's DCS command set: CASET, RASET, RAMWR, MADCTL, INVON and sleep. Its window and orientation come from the facts.
  - **Power.** A `PowerLatch` watches SYS_EN.
  - **Sensors.** `Ina226` and the divider go on as attachments.
  - **Serial.** `LineSource` feeds GPIO18.
- **small-screen-touch.** Adds `Cst816` at 0x15, which pulses INT and is cleared by RST.
- **panel-7.**
  - **Display.** `RgbFrame` takes the LCD_CAM frames the engine assembles.
  - **Touch.** `Gt911` at 0x5D.
  - **Backlight.** `BacklightHelper` at 0x30 lights the frame only after `0x10`, so a firmware that never sends it shows a dark panel, as the real board does.
- **headless.** `StatusLight` records the GPIO2 level timeline. The attachments are as their facts list.

### 3.5 Firmware: public samples for tests, and the user's own images

**Why the repository ships its own samples and no one's release images:**

- A product's release image embeds that product's own broker host and site URL.
- Fetching such images from a public CI would tie an open-source project to a private deployment.
- So the public repository neither contains nor downloads anyone's product images; users bring their own.

**Public sample firmware, one per board** (`sample-firmware/*.yaml`):

- **How they are built.** ESPHome at a pinned version, its container pinned by digest, on ESP-IDF, with only public ESPHome components. They are **built to use each board the way real battery-monitor firmware does**: the same display drivers (`mipi_spi` ST7789V, `mipi_rgb`), `cst816`, `gt911`, `ina226`, `adc`, `uart`, `improv_serial`, `esp32_ble_tracker`, `mqtt` with `tls: true` and certificate checks on, and `web_server`.
- **What they connect to.**
  - **Broker.** `broker.replica.test`, port 8883. `.test` is reserved by RFC 6761 and can never be a real host.
  - **Trust.** The sample reads its CA from a data partition (`replica_ca` in `partitions.csv`). The harness writes that partition at load (`esp32sim_load_at`) with **a CA generated for that run**. Verification stays on, and no key is ever committed.
  - **Credentials.** Anonymous: no MQTT credentials at all.
- **What they log.** Each sample logs one line per heard BLE advertiser name, so the scan can be asserted.
- **Where they come from.** `tools/build-samples.sh` builds `factory.bin` **and `firmware.elf`**, the ELF that BLE needs.
  - CI builds them, cached by the YAML and digest.
  - `samples.lock` pins their SHA-256, the image (the `linux/amd64` manifest digest) and the build platform. One canonical binary: the script builds on that platform on every host, emulated where the host differs, because arm64 and amd64 toolchains produce different bytes. Re-lock by building twice and comparing the printed hashes.
  - Once a release is published, contributors can download them instead of building, verified against the lock.
- **Licence.** The YAML is MIT. The built binaries contain ESPHome's GPLv3 C++ runtime, so release assets ship with a NOTICE pointing at this source and the pinned ESPHome version (Q7).

**Bring your own image:**

```
pnpm replica run --board small-screen --image ./factory.bin [--elf ./firmware.elf] \
     --wifi ssid=lab,psk=… --map <name your image dials>=local [--trust ./ca.pem --cert ./broker.pem --key ./broker.key]
```

1. **Validation.** `FlashImage` checks the image before boot:
   - the `0xE9` magic at the bootloader offset for the board's chip;
   - a flash size in the header that does not exceed the board's;
   - a partition table that parses at `0x8000`, with an app at an `app` partition;
   - and, given `--expect-md5`, the app region's MD5.

   Anything wrong is refused by name.
2. **Network.** `--map NAME=local` makes `NodeSocketNetwork` answer the guest's DNS query for `NAME` with a TEST-NET-3 address (203.0.113.0/24) and carry flows to it to the local `TlsHelloListener` or broker. The image is never modified.
3. **What can be proven.** Without `--trust`, the run proves everything up to certificate verification: the listener records the ClientHello and its SNI, and the image's refusal of an untrusted certificate is asserted as a refusal. With a CA the image already trusts (the user's own lab CA) and a certificate it accepts, the full MQTT session runs.
4. **Privacy.** Nothing about a user's image leaves their machine. Host names belong in a config file the user keeps outside the repository (`--config path`), never in it.

### 3.6 What "working" means

**How every run is set up:**

- **Fixed inputs.** A fixed MAC, a `FixedClock`, a fixed emulated duration, `OfflineNetwork` except for mapped names, and one Wi-Fi spec: `ssid=replica-lab,psk=replica-lab-pass`.
- **Setup.** The setup is the standard one: Improv `WIFI_SETTINGS` over the console.
- **Known answers.** The expected values come from declarations:
  - the sample's project name and version;
  - `broker.replica.test`;
  - the INA226's LSBs (1.25 mV bus, 2.5 µV shunt);
  - the divider ratios in the facts.

| Check | small-screen (and touch) | panel-7 | headless |
| --- | --- | --- | --- |
| **Boots** | console names the sample and its version; no chip reset within the run | same, UART0 | same, UART0 |
| **NVS survives a restart** | the Wi-Fi set by Improv is reused after a restart | same | same (classic is upstream's least mature chip) |
| **Draws its screen** | 240×280 frame, not blank, upright, bit-identical to the reviewed golden; BOOT moves to the next page; touch (touch board) does the same | 800×480, dark until `0x10` reaches 0x30, then the golden; a GT911 tap changes the frame | no screen: the GPIO2 timeline matches the sample's declared blink pattern |
| **Joins Wi-Fi** | the DHCP ACK for 10.0.2.15 seen in the network frames, and the firmware's "connected" log | same | same |
| **TLS to a broker** | ClientHello SNI `broker.replica.test`; with the per-run CA the full MQTT CONNECT and one publish reach `InProcessMqttBroker`; with a wrong CA the device refuses and no MQTT byte arrives | same | same |
| **Sensors** | INA226 at 13.000 V gives 13.0 V; ADC GPIO1 at 1.25 V gives 3.75 V ± 0.05 V (synthetic ADC curve); a line on GPIO18 is logged | INA226 as left | divider GPIO36 at 1.8 V gives 3.6 V ± 0.05; INA226 as left |
| **BLE scan** | with the sample's ELF, advertisers named `JK_REPLICA1`, `JBD-REPLICA1` and `DL-REPLICA1` are logged; an unknown name is logged as not a battery | same | same |

Connecting to a battery management system over GATT is **not v1**, because upstream's virtual peer is one fixed peripheral (§9).

---

## 4. The order

| Stage | What | Why here |
| --- | --- | --- |
| **S0a** | Repository, public project files, `AGENTS.md`, lint and TypeScript, the architecture guards and the privacy guard, CI skeleton | the rules and guards exist before any code they govern |
| **S0b** | Vendoring, the seam, the wasm build, `WasmEmulatorEngine` + `HostBoardBridge`, `NodeSocketNetwork`/`OfflineNetwork`, `ImprovSerial`, `TlsHelloListener`, `TestCa`, `FlashImage`, the contract suites; upstream's own S3 and classic `hello_world` boot through TypeScript | everything a board stands on |
| **S1** | **small-screen** + its sample firmware | the first board; the S3 is the mature chip; the sample's BLE is off in S1, so a BLE start-up problem cannot hide a boot failure |
| **S2** | small-screen-touch (`Cst816`) | one new device on a board that already works |
| **S3** | panel-7 (`RgbFrame`, `Gt911`, `BacklightHelper`) + sample | new display path; PSRAM execution; LVGL |
| **S4** | headless (classic) + sample | upstream's least mature chip |
| **S5** | BLE scan on all four samples; Wi-Fi and BLE together | the hardest limit; needs the ELFs, which the samples provide |
| **S6** | Browser demo of small-screen, offline (recommended; may drop out of v1) | the same TypeScript host in a Web Worker |

---

## 5. Agents and cost

**The workflow.**

- **Architect, builders, reviewer.** An Opus architect has planned (this file). One Sonnet builder per stage works from it. One Opus reviewer per stage reviews, and only the reviewer commits.
- **Pushing is the maintainers' step**, and so are creating the GitHub repository and publishing (§7.4).
- **Order and concurrency.** Stages run in order, so **at most two agents run at once**: a builder, and the previous stage's reviewer.
- **File ownership.** No two builders share a file, because each stage adds its own files. The one shared file, `boards/src/board-catalogue.ts`, gets one line per stage, in sequence.
- **Small follow-ups.** The stage reviewer approves them without a new architect.

| Stage | Builder owns |
| --- | --- |
| S0a | root config files, `LICENSE`, `NOTICE.md`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `AGENTS.md`, `.github/**`, `test/guards/**`, `packages/core/**` (skeleton and units) |
| S0b | `third_party/**`, `engine.lock`, `tools/**`, `packages/{engine,network,setup,firmware,cli}/**`, `packages/boards/src/board-catalogue.ts`, `test/contracts/**`, `test/fakes/**`, `test/acceptance/s0-*.test.ts` |
| S1 | `packages/devices/src/{dcs-panel,ina226,power-latch,line-source}.ts`, `packages/boards/src/small-screen-board.ts`, `facts/boards.json` (small-screen), `sample-firmware/{small-screen.yaml,common/*,partitions.csv}`, `sample-firmware/samples.lock`, `test/acceptance/s1-*.test.ts`, `test/goldens/small-screen/**`, `docs/boards.md` (its section) |
| S2 | `packages/devices/src/cst816.ts`, `withTouch` in `small-screen-board.ts`, `sample-firmware/small-screen-touch.yaml`, `test/acceptance/s2-*.test.ts`, goldens, docs section |
| S3 | `packages/devices/src/{rgb-frame,gt911,backlight-helper}.ts`, `packages/boards/src/panel-board.ts`, `sample-firmware/panel-7.yaml`, tests, goldens, facts, docs section |
| S4 | `packages/devices/src/status-light.ts`, `packages/boards/src/headless-board.ts`, `sample-firmware/headless.yaml`, tests, goldens, facts, docs section |
| S5 | the BLE parts of the four sample YAMLs, `test/acceptance/s5-*.test.ts` |
| S6 | `packages/web/**`, the seam's web registration if needed, `test/acceptance/s6-*.test.ts` |

**Optional parallelism.** After S1 is reviewed, S3 and S4 touch disjoint files (apart from the sequenced catalogue line) and *may* run as two builders at once. **Default: no**, the cheaper sequential path.

**Cost, estimated and not measured.**

- 8 builder runs + 8 reviews, about 6–8 builder days in all:
  - S0b and S1 are the largest, because they hold the first ESPHome boot on this engine;
  - S2 is the smallest.
- The main token risk is a builder looping on an unmodelled register. The reviewer stops a stage rather than let it model peripherals the samples never touch.
- **Running cost: none.** Public GitHub Actions minutes are free for public repositories, and there is no hosting or paid service. If the maintainers want the browser demo on GitHub Pages later, that is free too, and it is the owner's step.

---

## 6. The rules this repository keeps

The repository ships its own `AGENTS.md`. Each rule below has a number (`§1`...) that `AGENTS.md` cites in a `Rule:` line, and `AGENTS.md` carries every rule marked "As written" or "Adapted" and names the guard that enforces it.

| Rule | Here |
| --- | --- |
| §1 Dependency inversion: ports first, constructor injection, `readonly` dependencies, one composition root, no singletons, no `I` prefix | **As written.** There is no process-wide mutable slot |
| §2 Layers point inward, enforced by an architecture test; a hand-rolled composition root | **As written**, with this repo's layers (§3.1) |
| §3 Ports and adapters: a transport library only in its adapter directory; malformed input dropped by the adapter; `fetch` only in the download adapter | **Adapted.** The confined technologies are the wasm C ABI (`engine/adapters/wasm`), `node:net` and `node:tls` and the MQTT broker library (`network/adapters/node`), and the container CLI (build scripts only) |
| §4 Testing: a fake per port, shared contract suites, guards check each occurrence, know what a guard excludes, a deliberate break must change what the test reads, three clean runs for anything timing-sensitive, refusals asserted not inferred | **As written** |
| §5 Style: classes only (static helpers on a class with a private constructor), one object parameter for more than one value, never more than two arguments, no flag arguments, no `any`, fewer comments, configuration read once in the entry | **As written.** One `ConfigurationReader` class in each entry (`cli/main.ts`, `web/worker-composition.ts`) reads `process.env` or the page, and nothing else does |
| §6 Decimal maths for simulated quantities | **Adapted**: decimal.js for every analogue conversion in `devices`, JS numbers only at named boundaries |
| §7 One source of truth; a duplicate must be asserted equal, by identity | **As written.** The facts file is the one definition of every pin |
| §8 For a unit, the declaration wins; bounds are data and asserted | **As written** (`core/units.ts`; the INA226 LSBs and ADC ranges are cited from datasheets) |
| §9 Rules live in TypeScript, not in the vendored Rust | **Adapted**: the seam stays a generic bridge with no board knowledge |
| §10 Every import is declared in the package that uses it | **As written** |
| §11 No modes and no feature flags | **As written.** CLI run options (`--board`, `--map`) are inputs, not feature switches |
| §12 What already works keeps working: pin today's behaviour before a change; breaking a CLI option, the facts schema or the public package API is a decision with a version bump | **As written** |
| §13 A plan comes first; acceptance criteria are read before "done"; independent review; classes, DI, SOLID, hexagonal, clean code | **As written** (plans in `docs/planning/`) |
| §14 No product or vendor names in identifiers (protocols, standards and chip families allowed) | **As written** |
| Anything else a larger platform needs: tenancy, an HTTP API, persistence, payments, deploys | **Do not apply.** This repository has none of them and takes only public npm and crates dependencies |

**How the guards enforce the rules.** All guards are Vitest tests under `test/guards/`. They read the code through the TypeScript compiler API, not by grepping text. Each one is seen red on a deliberate break, made in a scratch copy and confirmed to change what the guard reads.

| Guard | Fails on |
| --- | --- |
| `layers-point-inward` | an import from a higher layer, or from one adapter into another (§3.1) |
| `only-roots-construct` | a `new` of an exported concrete class outside the composition-root files pinned in `COMPOSITION_ROOTS` (tests excepted) |
| `no-product-names` | an exported identifier containing a listed product or vendor name (Waveshare, Elecrow, CrowPanel, Esp32sim, Espressif, ESPHome, Mosquitto, Aedes, Rustls and the like); adapter *directory* names are sanctioned by exact path |
| `classes-only` | a top-level `function` or a function assigned to a module-level `const` outside framework-required spots (the wasm import table in `host-imports.ts`, pinned by exact name) |
| `two-arguments-at-most` | any function, method or constructor with more than two parameters, except the wasm import signatures, which are pinned exactly. A sanction that matches nothing is itself a failure |
| `one-configuration-reader` | `process.env` outside `ConfigurationReader` |
| `transport-confined` | `node:net`, `node:tls`, the broker library, `WebAssembly.*` or `fetch` outside their adapter directories |
| `facts-have-public-sources` | a fact without an https `source`, or a pin literal in a board or device file |
| `vendored-tree-matches-the-lock` | any vendored file changed outside the seam list |
| `nothing-private` | see §7.2 |

---

## 7. Open source

### 7.1 Licence

- **This project is MIT.** That is compatible with esp32sim's MIT licence and the simplest choice for an emulator other people may embed.
- **`LICENSE`** carries this project's MIT notice (holder: Q9).
- **`third_party/esp32sim/LICENSE`** and **`esp-periph/LICENSE-ADC`** stay byte for byte. `NOTICE.md` names esp32sim's copyright holders, the Apache-2.0 ADC data, the downloaded Espressif ROM ELFs (Apache-2.0, never committed), and ESPHome (MIT YAML, GPLv3 runtime in built samples).

### 7.2 Nothing private in it

- **Excluded entirely:**
  - secrets, keys and tokens;
  - production hosts and addresses;
  - customer data;
  - any document that describes a private platform.
- **Board facts** come only from public sources.
- **Tests** use local fakes, the in-process broker and per-run certificates generated in memory.

**The `nothing-private` guard** runs in CI over every tracked file (`git ls-files`). It fails on any of these:

- a private key block (`-----BEGIN … PRIVATE KEY-----`), a certificate file other than generated output, or common token shapes (GitHub, npm, cloud provider keys);
- a tracked `.env*` file;
- an absolute path into a home directory or a mounted volume;
- an IPv4 address outside documentation and loopback ranges (TEST-NET 1–3, 10.0.2.0/24 for the emulator's subnet, 127/8);
- **any token matching a pinned list of SHA-256 hashes of forbidden host names and key prefixes.**
  - Private hosts and key prefixes are hashed, so the guard stops them **without the public repository naming them**.
  - The maintainers add hashes with `pnpm guard:hash <name>`.

`.gitignore` excludes `.env*`, images and builds. The guard's own fixture for a deliberate break lives in a temporary directory and is never committed.

### 7.3 Public project files

- **README.md**: what it is, the four boards, the scope limit, quick start, bring your own image.
- **CONTRIBUTING.md**: setup (Node, pnpm, Rust only for the engine, Docker only for samples), the checks CI runs, goldens, the rules in `AGENTS.md`, and the scope: replicas of these four boards only.
- **CODE_OF_CONDUCT.md**: Contributor Covenant 2.1.
- **SECURITY.md**: GitHub private vulnerability reporting; never a public issue.
- **Issue and PR templates.**
- **`ci.yml`**:
  - runs on push and pull requests, with `permissions: contents: read` and actions pinned by SHA;
  - **uses no secrets**;
  - runs lint, typecheck, unit tests and guards;
  - builds the engine (Rust wasm, cached);
  - builds the samples (ESPHome container by digest, cached);
  - runs the acceptance tests.

### 7.4 The maintainers' steps (listed, not done)

1. Choose the repository name (Q11) and the licence holder (Q9).
2. Create the public GitHub repository, and push once the reviewed v1 commits exist.
3. Enable private vulnerability reporting, protect the default branch with "CI must pass", and require review.
4. Publish the first sample-firmware release assets (built by CI), with their NOTICE.
5. Optionally publish the TypeScript packages to npm, and the browser demo to GitHub Pages.
6. Optionally offer the seam upstream to mikroverk/esp32sim (Q2).
7. Privately, outside this repository: put the hashes of any private host in the local, untracked hash list the `nothing-private` guard also reads (§7.2).

---

## 8. Acceptance criteria

Each criterion names the test that proves it. Paths are under `test/acceptance/` unless stated otherwise.

- **What "done" means.** `pnpm check` passes with zero failures: lint, typecheck, every Vitest project including the guards and contract suites, the engine's `cargo clippy -D warnings` and upstream's own tests inside `third_party/esp32sim`.
- **Tests that need downloads** are skipped by default in an unprepared checkout: they need the ROM ELFs (Apache-2.0, fetched by `pnpm fetch:roms`), the engine and the samples. They always run in CI and under `pnpm check:full`.

### S0a: Rules, guards, public files

| # | Criterion | Test |
| --- | --- | --- |
| AC0a.1 | Each guard in §6 fails on a deliberate break made in a scratch copy, and the break changes what the guard reads | `test/guards/*.test.ts`, each with a `breaks-on` case built from a temporary fixture |
| AC0a.2 | `nothing-private` fails on each pattern class in §7.2 (a private key block, a `.env`, an absolute home path, a non-documentation IPv4, a hashed host) and passes on the tree | `test/guards/nothing-private.test.ts` |
| AC0a.3 | The public files exist and say what §7.3 lists; `ci.yml` has `contents: read`, no `secrets.` reference, actions pinned by SHA | `test/guards/public-project-files.test.ts` |
| AC0a.4 | `AGENTS.md` carries every "As written" and "Adapted" rule in §6 and names each guard that enforces it; every guard it names exists | `test/guards/agents-names-real-guards.test.ts` |

### S0b: The engine through TypeScript

| # | Criterion | Test |
| --- | --- | --- |
| AC0b.1 | Every vendored file equals esp32sim `d043ff1d` by the SHA-256 in `engine.lock`, except the seam's listed files | `test/guards/vendored-tree-matches-the-lock.test.ts` |
| AC0b.2 | The seam changes nothing for upstream: its own tests for the crates the replicas use and its S3 and classic `hello_world` goldens pass unchanged | `pnpm engine:test` (`tools/engine-test.sh`, upstream's suite in `third_party/esp32sim`), run as its own CI step; the RISC-V chip crates' suites are not run |
| AC0b.3 | Upstream's S3 and classic `hello_world` boot through `WasmEmulatorEngine`, with console lines equal to upstream's goldens | `s0-engine.test.ts › hello world boots through the TypeScript host` |
| AC0b.4 | `HostBoardBridge` answers a guest I2C read synchronously, hands SPI bytes over in order with the D/C level of their moment, passes GPIO, UART TX and LCD frames on, and takes UART RX bytes from the host | Proven by unit tests only: `host-board-bridge.test.ts` (TypeScript, over guest memory) and the `host_board` tests in the seam (`cargo test`, native). **Open, carried to S1:** no firmware has yet exercised I2C, SPI or LCD through the wasm module, and UART RX into the guest through TypeScript has no `EngineInput` kind and no caller; S1's sample firmware proves them |
| AC0b.5 | Console input is byte-exact for every value 0x00–0xFF (upstream's `bytes` hex message already is, so the seam adds no message) | `s0-engine.test.ts › console bytes arrive unchanged`: the mask ROM in download mode accepts a block of all 256 values by its checksum and refuses one byte changed |
| AC0b.6 | `EmulatorEngine`, `GuestNetwork` and `FirmwareSource` each pass one shared contract suite against both of their implementations | `test/contracts/*.contract.ts`, run by `s0-contracts.test.ts` |
| AC0b.7 | `NodeSocketNetwork` answers a mapped name with a TEST-NET-3 address and carries the flow to a local listener; an unmapped name is refused (asserted as a refusal, by name) | `s0-network.test.ts` |
| AC0b.8 | `FlashImage` accepts a valid S3 and a valid classic image, and refuses a wrong magic, an oversized flash header, a broken partition table and an MD5 mismatch, each by name | `s0-firmware.test.ts` |
| AC0b.9 | `ImprovSerial` frames `WIFI_SETTINGS` as ESPHome's `improv_serial` at the pinned version expects (vectors from its source, cited) | `packages/setup` unit test `improv frames match the protocol` |
| AC0b.10 | `TlsHelloListener` records the SNI of a node:tls client, refuses it and reports zero application bytes; with a `TestCa` certificate it completes | `packages/network` unit tests |

### S1: small-screen

| # | Criterion | Test |
| --- | --- | --- |
| AC1.1 | The sample `factory.bin` builds reproducibly from `small-screen.yaml` at the pinned ESPHome digest, and its SHA-256 equals `samples.lock` | `s1-small-screen.test.ts › the sample matches its lock` (CI builds; locally it verifies a download) |
| AC1.2 | It boots unchanged: console names the sample and version, with no reset in 20 emulated seconds | `› boots` |
| AC1.3 | The frame is 240×280, not blank (at least 8 colours), upright, and bit-identical to the reviewed golden; the reviewer opens the PNG | `› the screen matches its golden` |
| AC1.4 | BOOT (GPIO0) shows the next page; SYS_EN (GPIO41) is high after boot, and a 3.5 s PWR (GPIO40) hold drives it low in the board's report | `› buttons and the power latch` |
| AC1.5 | Improv sets Wi-Fi; the DHCP ACK for 10.0.2.15 appears in the network frames; after a restart the saved network is reused | `› improv wifi joins and survives a restart` |
| AC1.6 | With the per-run CA in `replica_ca`, the device completes TLS to `broker.replica.test` (SNI asserted), sends MQTT CONNECT and one publish to `InProcessMqttBroker`; with a different CA it refuses, and no MQTT byte arrives | `› mqtt over tls`, `› an untrusted certificate is refused` |
| AC1.7 | INA226 at 13.000 V bus (LSB 1.25 mV) reads 13.0 V; ADC GPIO1 at 1.25 V reads 3.75 V ± 0.05 V; a line sent on GPIO18 at 115200 baud is logged by the sample | `› attachments read their declared units` |
| AC1.8 | A user image runs the same way: `replica run --image` boots the sample through `UserImageSource`, and a corrupted copy is refused before boot | `› bring your own image` |

### S2: small-screen-touch

| # | Criterion | Test |
| --- | --- | --- |
| AC2.1 | ESPHome's `cst816` driver finds the controller at 0x15 (chip ID and registers cited from the driver at the pinned tag) | `s2-touch.test.ts › the driver finds the controller` |
| AC2.2 | A tap pulses INT (GPIO14) and shows the next page; RST (GPIO13) clears a pending touch | `› a tap shows the next page`, `cst816` unit tests |
| AC2.3 | S1's tests still pass unchanged | S1 suite, rerun |

### S3: panel-7

| # | Criterion | Test |
| --- | --- | --- |
| AC3.1 | The sample boots with PSRAM execution and logs on UART0 | `s3-panel.test.ts › boots` |
| AC3.2 | The panel is dark until `0x10` reaches 0x30, then shows 800×480 matching the golden | `› the backlight helper lights the panel`, `› the screen matches its golden` |
| AC3.3 | A GT911 tap at 0x5D changes the frame | `› a tap changes the screen` |
| AC3.4 | Wi-Fi and MQTT over TLS as AC1.5–1.6 | `› wifi and mqtt` |
| AC3.5 | The RGB pins the board accepts equal ESPHome's `CROWPANEL-ADVANCE-7` model at the pinned tag (from facts) | `› rgb pins match the model` |

### S4: headless

| # | Criterion | Test |
| --- | --- | --- |
| AC4.1 | The classic sample boots at 4 MB; NVS survives a restart (checked first) | `s4-headless.test.ts › boots`, `› nvs survives a restart` |
| AC4.2 | GPIO2's timeline matches the sample's declared pattern for "no Wi-Fi" and "Wi-Fi, no broker", within one sampling step | `› the status light shows its state` |
| AC4.3 | Divider GPIO36 at 1.8 V reads 3.6 V ± 0.05 V; INA226 on SDA 21 / SCL 22 at 13.000 V reads 13.0 V | `› attachments read their declared units` |
| AC4.4 | Wi-Fi and MQTT over TLS as AC1.5–1.6 | `› wifi and mqtt` |

### S5: BLE scan

| # | Criterion | Test |
| --- | --- | --- |
| AC5.1 | With its ELF, each sample logs `JK_REPLICA1`, `JBD-REPLICA1` and `DL-REPLICA1` from `ble_nearby` | `s5-ble.test.ts › each name is heard` |
| AC5.2 | An unknown name is logged as "not a battery" (a refusal asserted by name) | `› an unknown name is not a battery` |
| AC5.3 | Wi-Fi + MQTT and BLE run together on small-screen | `› wifi and ble together` |

### S6: browser demo (optional)

| # | Criterion | Test |
| --- | --- | --- |
| AC6.1 | The worker host boots the small-screen sample with the same TypeScript boards, and its frame equals the Node golden | `s6-browser.test.ts` (headless browser) |
| AC6.2 | The page says the browser has no network past the gateway | `› the page states its limit` |

---

## 9. Risks and limits

| Risk | Mitigation |
| --- | --- |
| **ESPHome images are new to esp32sim** (§1.1): an unmodelled register is likely on first boot | Samples start with BLE off; a missing *SoC* model becomes an upstream-style fix in a second, separately listed seam commit, approved by the reviewer, never folded in silently |
| **The seam is Rust inside a TypeScript project** | It is kept generic (no board knowledge, rule §9), pinned by the lock guard, and offered upstream |
| **Synchronous imports per bus event** may slow screen-heavy firmware | Bytes cross as wasm memory views, not copies; measured in S1 and S3 and reported as observed figures |
| **Speed under Node** is not measured here | Tests run on fixed emulated time, never wall time; a timing-sensitive test needs three clean runs before any verdict |
| **Wi-Fi on ESP-IDF 5.5.x (the pinned ESPHome's IDF)**: upstream validated up to 5.5.4 | AC1.5 is the test; a failure is reported against the blob version |
| **BLE**: one link, MTU 23, no pairing; nearby advertisers are non-connectable | v1 asserts scanning only; GATT battery peers are later work |
| **Wi-Fi + BT coexistence**: radio registers are faked upstream | S5 tests them together (AC5.3) |
| **Classic is "early" upstream** | AC4.1 asserts that NVS survives a restart before anything else |
| **Determinism of goldens** | Fixed MAC and clock; a golden unstable over three runs is a defect, never a retry |
| **ESPHome's GPLv3 runtime in the built samples** | The YAML stays MIT; binaries are release assets with a NOTICE and the pinned source; never committed (Q7) |
| **Something private slips in** | The `nothing-private` guard with hashed host names (§7.2); the reviewer checks every commit's diff |
| **Upstream drift** | Pinned commit; a re-vendor is its own reviewed job |

## 10. Later (recommended, out of v1)

- **Other projects use the replicas from outside.** They would consume this project's published npm packages or a Docker image of its CLI, and run their own release images through `replica run --image … --map …` in their own CI, where their production names live. This public repository never learns those names.
- **GATT battery peers** (JK, JBD and Daly protocols) so a firmware can connect and read frames.
- **The browser demo with a network**, through the NAT relay and a WebSocket bridge.

## 11. Open questions (with the default this design uses)

| # | Question | Default |
| --- | --- | --- |
| Q1 | (a) port to TypeScript, or (b) drive esp32sim's wasm from a TypeScript host? | **(b)**, all our code TypeScript, with one generic Rust seam in the vendored engine |
| Q2 | Offer the seam upstream? | After v1, yes |
| Q3 | Vendor a subset, rather than depend or fork? | Vendor the subset at `d043ff1d`, pinned by `engine.lock` |
| Q4 | Public sample firmware for tests, and users' own images by `--image`, with no product's release images in the repository? | Yes |
| Q5 | PSRAM size on both S3 boards? | 8 MB (N16R8 modules), marked unverified until a public datasheet is cited |
| Q6 | Sample firmware in ESPHome (a common stack for real devices) rather than plain ESP-IDF? | ESPHome, pinned by digest |
| Q7 | Publish the built samples (which contain ESPHome's GPLv3 runtime) as release assets with a NOTICE? | Yes; never committed |
| Q8 | Is the browser demo (S6) in v1? | Yes, last and optional; local until the maintainers publish Pages |
| Q9 | Licence holder in `LICENSE`? | The maintainers' name, supplied by them |
| Q10 | Board ids by role (`small-screen`, `small-screen-touch`, `panel-7`, `headless`)? | Yes |
| Q11 | Public repository name? | `esp32-replicas` (the local folder can keep its name) |
