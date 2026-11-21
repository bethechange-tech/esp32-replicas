# Boards

One section per replica: what is modelled, what is not, and where each fact comes from. Every number and name is in `facts/boards.json`, with its unit and a public source; a board class holds none.

## small-screen: Waveshare ESP32-S3-LCD-1.69 (V2)

CLI id `small-screen`. Class `SmallScreenBoard`, built from the facts and four devices.

**Modelled**

| Part | Device class | What it does |
| --- | --- | --- |
| ST7789V2 display, SPI | `DcsPanel` | Commands and data are told apart by the level of the D/C pin at the moment of each SPI transaction. CASET, RASET, RAMWR, MADCTL (mirror and axis swap), INVON/INVOFF, sleep and display on/off, software reset. 240x320 RAM, a 240x280 window at row offset 20. The glass is mounted mirrored in both axes, and the firmware compensates with MADCTL, so a frame comes out upright. An IPS panel shows the stored colour only while inversion is on. |
| INA226 current and voltage monitor, I2C `0x40` | `Ina226` | Register protocol of the datasheet: configuration (with its reset bit), shunt (2.5 uV per count), bus (1.25 mV per count), power, current, calibration, mask, alert limit, manufacturer and die IDs. |
| Power latch, SYS_EN on GPIO41 | `PowerLatch` | Watches the pin; the board's report says whether the firmware holds power. |
| Serial line into GPIO18 at 115200 baud | `LineSource` | Turns a text line into the bytes the firmware's UART receives. |
| Battery sense, GPIO1 through a 3:1 divider | `UnitArithmetic` | `SmallScreenBoard.packVolts` gives the pin voltage to hand the engine's ADC. Conversions are decimal.js. |

**Not modelled** (the boards' firmware does not use them): QMI8658, PCF85063, the buzzer, backlight PWM level (the frame does not depend on it), and the touch controller (that is `small-screen-touch`, below).

**Display orientation** is a model decision recorded as the decisions `display-mirror-x` and `display-mirror-y` in the facts file (no source: they are a choice of the model, not a cited fact): the glass reads the RAM mirrored, and the sample's ESPHome `mipi_spi` configuration sets the matching `transform`. If the real board differs, change the two flags.

**Sample firmware** `sample-firmware/small-screen.yaml` is built by `tools/build-samples.sh` with the ESPHome version, container digest and build platform in `sample-firmware/samples.lock`. The digest names the `linux/amd64` image and the script passes the locked platform to Docker, so every host builds the same bytes (an arm64 host emulates amd64, about four minutes cold on a Mac); the two architectures' toolchains give different binaries, so the lock holds one. It draws two pages (BOOT shows the next), logs the INA226 and ADC readings, logs lines received on GPIO18 (and restarts on the line `restart`), takes Wi-Fi from Improv serial, reads its trust anchor from the `replica_ca` data partition, and connects to `broker.replica.test:8883` over TLS without credentials. BLE is off. The built binaries contain ESPHome's GPLv3 runtime and are never committed.

**Network timing.** A reply from a host socket reaches the guest at the first relay pump after the host socket delivers it, so its emulated arrival time depends on host load. The tests do not assert on that time: they wait for an outcome within a window of emulated time, which absorbs it.

## small-screen-touch: Waveshare ESP32-S3-Touch-LCD-1.69 (V2)

CLI id `small-screen-touch`. The same class, built by its second named constructor: `SmallScreenBoard.withTouch` adds one device, `Cst816`, to everything `small-screen` has (`withoutTouch` builds the board without it). Its facts are the `small-screen-touch` entry of `facts/boards.json`: every fact of `small-screen`, restated with the touch board's own public pages as sources and asserted equal by a test, plus three more.

| Fact | Value | Source |
| --- | --- | --- |
| `touch-address` | I2C `0x15` | the Waveshare wiki's I2C section for this board ("the 7-bit device address of the chip is 0x15"); ESPHome's `cst816` also defaults to it |
| `touch-interrupt` | GPIO14 | Waveshare's demo for this board, linked from the wiki ([zip](https://files.waveshare.com/wiki/ESP32-S3-Touch-LCD-1.69/ESP32-S3-Touch-LCD-1.69_Demo.zip)): `Arduino/libraries/Mylibrary/pin_config.h`, `#define TP_INT 14` |
| `touch-reset` | GPIO13 | the same file, `#define TP_RST 13` |

**Modelled**

| Part | Device class | What it does |
| --- | --- | --- |
| CST816T touch controller, I2C `0x15` | `Cst816` | One touch with a 12-bit position. The firmware reads it as the driver does: registers `0x00` to `0x0C` in one burst (the touch count at `0x02`, X at `0x03`/`0x04`, Y at `0x05`/`0x06`), the chip ID at `0xA7` (`0xB5`, the CST816T), and a write to the IRQ control register `0xFA` (the driver writes `0x70`). INT (active low) is driven by the host: `SmallScreenBoard.fingerDown` and `fingerUp` change the touch and return the inputs of one INT pulse, which the caller gives the engine in order. A low level on RST, driven by the firmware, clears a touch that has not been read and the registers the firmware wrote. |

The register map and the chip identifiers are the ones in ESPHome's driver at the version `samples.lock` pins: [`cst816_touchscreen.h`](https://github.com/esphome/esphome/blob/2026.10.2/esphome/components/cst816/touchscreen/cst816_touchscreen.h) (`REG_STATUS` 0x00, `REG_TOUCH_NUM` 0x02, `REG_XPOS_HIGH` 0x03 to `REG_YPOS_LOW` 0x06, `REG_CHIP_ID` 0xA7, `REG_IRQ_CTL` 0xFA, `IRQ_EN_MOTION` 0x70, `CST816T_CHIP_ID` 0xB5) and [`cst816_touchscreen.cpp`](https://github.com/esphome/esphome/blob/2026.10.2/esphome/components/cst816/touchscreen/cst816_touchscreen.cpp) (the setup order: reset pulse, chip ID read, the chip ID check, then the IRQ control write; the 13-byte read and the `& 3` on the touch count). The driver marks itself failed on an unknown chip ID before it writes the IRQ control register, so a firmware that has written `0x70` has accepted the chip: the board's report shows it as `touch-irq-control`.

**Not modelled:** gestures (register `0x01` reads 0), more than one finger, the event flag in the position's high bits, sleep and auto-sleep (`0xE5`, `0xFE`), and the IRQ control bits' meaning (the value is kept, and INT pulses whatever it holds). The firmware version and factory ID read 0.

**Sample firmware** `sample-firmware/small-screen-touch.yaml` is `small-screen.yaml` plus a `cst816` touchscreen on GPIO14 and GPIO13, and it shares `common/*` with it. A tap (the finger down, then up, each with an INT pulse) shows the next page and logs `touch at X,Y` when the finger lands. A test asserts that both samples draw the same screen, so the two boards share one set of goldens (`test/goldens/small-screen/`). Built, hashed and locked like the first sample.

## panel-7: Elecrow CrowPanel Advance 7.0

CLI id `panel-7`. Class `PanelBoard`, built from the facts and three devices. Its facts are the `panel-7` entry of `facts/boards.json`.

| Fact | Value | Source |
| --- | --- | --- |
| Display | 800 x 480 parallel RGB565, pixel clock 20 MHz, pulse width 4, front and back porch 8 on both axes | ESPHome's `mipi_rgb` model `CROWPANEL-ADVANCE-7`, [`elecrow.py`](https://github.com/esphome/esphome/blob/2026.10.2/esphome/components/mipi_rgb/models/elecrow.py) at the version `samples.lock` pins |
| Display pins | enable 42, horizontal sync 40, vertical sync 41, pixel clock 39; red `7, 17, 18, 3, 46`; green `9, 10, 11, 12, 13, 14`; blue `21, 47, 48, 45, 38` | the same file |
| Touch | GT911 at I2C `0x5D` | the driver's primary address, [`gt911_touchscreen.cpp`](https://github.com/esphome/esphome/blob/2026.10.2/esphome/components/gt911/touchscreen/gt911_touchscreen.cpp) (`PRIMARY_ADDRESS`) |
| I2C | SDA 15, SCL 16, 400 kHz | a third-party project's pin header for this board, [`board_pins.h`](https://github.com/robominds/Crowpanel-Advance-7.0-HMI-Display/blob/dd9cee14af3d39902bc2f0acb82d96444aa95f08/src/board_pins.h) (`I2C_SDA`, `I2C_SCL`, `I2C_HZ`); a second public ESPHome configuration, [`hardware-crowpanel-advance7.yaml`](https://github.com/djb-rh/Joshua/blob/96a9300678040a715f9ad031bc3ef7318b8ef6bf/hardware-crowpanel-advance7.yaml), uses the same pins. **Unconfirmed against the vendor:** Elecrow's own page states none of these, so they are as reliable as those projects |
| Backlight helper | I2C `0x30`, switched on by the byte `0x10` | the same project's [`panel_mcu.h`](https://github.com/robominds/Crowpanel-Advance-7.0-HMI-Display/blob/dd9cee14af3d39902bc2f0acb82d96444aa95f08/src/panel_mcu.h): a companion microcontroller at `0x30`, written one bare byte with no register; on V1.2 `0x10` is on and `0x05` off. From V1.3 the scale is inverted (0 brightest, 244 dimmest, 245 off), so `0x10` is on there too, but at a dim level. **Unconfirmed against the vendor:** the project says Elecrow publish no specification for the part |

ESPHome's model carries no interrupt or reset pin for the touch controller, and the sample wires none: the driver polls. The chip, 16 MB flash and 8 MB octal PSRAM are taken from the vendor's page.

**Modelled**

| Part | Device class | What it does |
| --- | --- | --- |
| Parallel RGB panel | `RgbFrame` | Holds the latest whole frame the chip's LCD_CAM peripheral scanned out, as the firmware's framebuffer holds it (big-endian RGB565, which is what ESPHome's driver writes). A frame that is not 800 x 480 is dropped and counted. |
| Backlight helper, I2C `0x30` | `BacklightHelper` | Dark until the byte `0x10` is written to it; every other byte is acknowledged and ignored. `PanelBoard.frame` returns an all-black frame until then, as the real board shows a dark panel to a firmware that never lights it. |
| GT911 touch controller, I2C `0x5D` | `Gt911` | One touch. Registers are addressed by two bytes, high first, as the driver does: the maximum position at `0x8048` (the panel's size, low byte first), the switches at `0x804D`, the touch state at `0x814E` (bit 7 data ready, bits 0 to 2 the count) and the touch at `0x814F` (id, X low, X high, Y low, Y high). While the finger rests the state stays ready; after it lifts the state reads ready with no touch until the driver clears it, which is how the driver sees a release. |

**Not modelled:** more than one finger, the touch size and the key byte (the size reads a fixed value and the key byte 0), the configuration area other than what the driver reads, the interrupt pin, the helper chip's other commands (brightness, off) and the revision-dependent meaning of the byte, and the pixel clock's timing: the engine's own LCD_CAM model decides when a frame completes.

**Sample firmware** `sample-firmware/panel-7.yaml` uses ESPHome's `mipi_rgb` display with the model above and no pins of its own, a `gt911` touchscreen at `0x5D`, and `common/*` like the other samples. It draws two pages; a tap (finger down, then up) shows the next page and logs `touch at X,Y`. A touch in the bottom-right corner restarts it, standing in for the `restart` line the small-screen samples read. Four seconds after boot it writes `0x10` to `0x30`, so that the dark panel can be observed before the lit one; the real firmware for this board has no reason to wait. Built, hashed and locked like the other samples; `tools/build-samples.sh` also copies the model table out of the locked ESPHome image to `build/samples/panel-7/display-model.py`, which the pin test reads.
