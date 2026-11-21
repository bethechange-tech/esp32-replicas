# Roadmap

What is built, and what comes next, in order. Each stage adds its own files and a public sample firmware, and is accepted by named tests.

## Done

| Stage | What it gives |
| --- | --- |
| S0 | Rules and guards, the engine driven from TypeScript, firmware validation, an in-process MQTT broker with TLS, Improv serial. |
| S1 | `small-screen`: an ST7789 SPI display, power latch, buttons, INA226 and ADC, a UART line, Wi-Fi and MQTT over TLS. |
| S2 | `small-screen-touch`: adds a CST816T touch controller. |
| S3 | `panel-7`: an 800x480 parallel-RGB panel, a GT911 touch controller and a backlight helper that keeps the panel dark until it is told to light it. |

## Next

**S4 headless.** A classic ESP32 board with a status LED, an optional INA226 and a resistor divider. Accept: it boots, NVS survives a restart, the LED's GPIO timeline matches the sample's pattern, the attachments read their declared units, and Wi-Fi and MQTT work as on the other boards.

**S5 BLE scan.** Samples hear advertisers by name, and a name that is not a battery is logged as such. Accept: each declared name is logged, an unknown one is refused by name, and Wi-Fi and BLE run together.

**S6 browser demo.** The same TypeScript boards in a Web Worker. Accept: the browser frame equals the Node golden, and the page states that the browser has no network beyond the gateway.

## Generic engine stages

Each is a generic change to the engine seam or a host adapter, with no board knowledge in Rust, reviewed and listed on its own.

**S7 per-instance MAC.** Give each simulated device its own MAC. Accept: two instances report different MACs, and a run with a chosen MAC reports it.

**S8 inbound TCP.** Let a host program open a connection to the device's own web page. Accept: a request to a forwarded port is answered by the sample's `web_server`.

**S9 name mapping.** Answer every name the image resolves with a local listener, and record each name. Accept: a sample that resolves several names has each one recorded.

**S10 Improv commands.** Send Improv RPC commands beside `WIFI_SETTINGS`. Accept: a command's reply is read back, with checksums checked.

**S11 Bluetooth links.** Connectable peripherals at any address, several links at once, served by the host, with JK, JBD and Daly peers over the public protocols. Accept: a sample connects to each peer and logs its decoded values.

**S12 hotspot and station.** A station that joins the device's own hotspot, then the device in AP+STA with a time-boxed spike first. Accept: a station joins, takes a lease and opens TCP to the device; AP+STA is accepted only if the spike shows the join works.

**S13 self-update.** The device updates itself over HTTP with rollback. Accept: a served image is fetched, applied and booted, and a bad one is rolled back.

## User interface

**S14 web app.** A static React app built with Vite that runs the simulator in a Web Worker in the browser and can be hosted free on GitHub Pages. It shows the board's screen and its console, offers the buttons and touch, and shows the network and Bluetooth activity. Accept: a headless-browser test loads the built page, boots a sample, shows its frame, taps the touch panel and sees the screen change.
