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

**Not modelled** (the boards' firmware does not use them): QMI8658, PCF85063, the buzzer, backlight PWM level (the frame does not depend on it), and the touch controller (that is `small-screen-touch`).

**Display orientation** is a model decision recorded as the decisions `display-mirror-x` and `display-mirror-y` in the facts file (no source: they are a choice of the model, not a cited fact): the glass reads the RAM mirrored, and the sample's ESPHome `mipi_spi` configuration sets the matching `transform`. If the real board differs, change the two flags.

**Sample firmware** `sample-firmware/small-screen.yaml` is built by `tools/build-samples.sh` with the ESPHome version and container digest in `sample-firmware/samples.lock`. It draws two pages (BOOT shows the next), logs the INA226 and ADC readings, logs lines received on GPIO18 (and restarts on the line `restart`), takes Wi-Fi from Improv serial, reads its trust anchor from the `replica_ca` data partition, and connects to `broker.replica.test:8883` over TLS without credentials. BLE is off. The built binaries contain ESPHome's GPLv3 runtime and are never committed.

**Network timing.** A reply from a host socket reaches the guest at the first relay pump after the host socket delivers it, so its emulated arrival time depends on host load. The tests do not assert on that time: they wait for an outcome within a window of emulated time, which absorbs it.
