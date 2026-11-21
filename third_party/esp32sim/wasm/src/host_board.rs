//! The host board: a generic bridge that forwards a board's events to the host, in order and
//! synchronously, so a board written outside this crate (in TypeScript, in a page or under Node)
//! can answer them. It knows no board: which I2C addresses answer, and whether SPI, UART and LCD
//! frames go to the host, are declared by the host (`esp32sim_new_host`).
//!
//! Spec text: `key=value` pairs separated by `;`. `i2c=BUS:ADDRESS,BUS:ADDRESS` (decimal), `spi=1`,
//! `uart=1`, `lcd=1`. An empty spec declares nothing; an unknown key or a malformed value is refused.
use esp_periph::i2c::I2cDevice;
use esp_soc::board::{Board, BoardModel, VirtualCycle};
use esp_soc::uart::{UartInput, UartRoute};
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

#[cfg(target_arch = "wasm32")]
mod wire {
    //! The record layouts of the wasm imports below; the host reads them by the same numbers.
    /// Bytes per GPIO record handed to the host: cycle (u64 LE), pin, level, six bytes of padding.
    pub const GPIO_RECORD_BYTES: usize = 16;
    /// Bytes of the SPI request header: host (u8), three padding bytes, `rx_len` (u32 LE).
    pub const GPIO_PIN_OFFSET: usize = 8;
    pub const GPIO_LEVEL_OFFSET: usize = 9;
    pub const SPI_HEADER_BYTES: usize = 8;
    pub const SPI_HOST_OFFSET: usize = 0;
    pub const SPI_READ_LENGTH_OFFSET: usize = 4;
    pub const FRAME_DIMENSION_BITS: u32 = 16;
    pub const I2C_BUS_SHIFT: u32 = 24;
    pub const I2C_ADDRESS_SHIFT: u32 = 16;
    pub const I2C_FLAG_SHIFT: u32 = 8;
    pub const OP_START: u32 = 0;
    pub const OP_WRITE: u32 = 1;
    pub const OP_READ: u32 = 2;
    pub const OP_STOP: u32 = 3;
}
#[cfg(target_arch = "wasm32")]
use wire::*;
/// What an undriven MISO line and an unanswered I2C read both give: all ones.
const SPI_IDLE_BYTE: u8 = 0xff;
const I2C_IDLE_BYTE: u8 = 0xff;

/// What the host answers. The wasm build calls imports; tests substitute a recording link.
pub trait HostLink {
    fn gpio(&self, cycle: VirtualCycle, changes: &[(u8, bool)]);
    fn spi(&self, host: u8, tx: &[u8], rx_len: usize) -> Vec<u8>;
    fn i2c_start(&self, bus: u8, address: u8, read: bool) -> bool;
    fn i2c_write(&self, bus: u8, byte: u8) -> bool;
    fn i2c_read(&self, bus: u8) -> u8;
    fn i2c_stop(&self, bus: u8);
    fn uart_tx(&self, port: u8, byte: u8);
    fn lcd_frame(&self, w: u32, h: u32, rgb565: &[u8]);
}

/// Answers nothing: I2C NACKs, SPI reads idle, the rest is dropped. What a native build links.
pub struct NullLink;
impl HostLink for NullLink {
    fn gpio(&self, _cycle: VirtualCycle, _changes: &[(u8, bool)]) {}
    fn spi(&self, _host: u8, _tx: &[u8], rx_len: usize) -> Vec<u8> { vec![SPI_IDLE_BYTE; rx_len] }
    fn i2c_start(&self, _bus: u8, _address: u8, _read: bool) -> bool { false }
    fn i2c_write(&self, _bus: u8, _byte: u8) -> bool { false }
    fn i2c_read(&self, _bus: u8) -> u8 { I2C_IDLE_BYTE }
    fn i2c_stop(&self, _bus: u8) {}
    fn uart_tx(&self, _port: u8, _byte: u8) {}
    fn lcd_frame(&self, _w: u32, _h: u32, _rgb565: &[u8]) {}
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    fn host_board_gpio(records: *const u8, count: usize);
    fn host_board_spi(buffer: *mut u8, len: usize) -> u32;
    fn host_board_i2c(op: u32, arg: u32) -> u32;
    fn host_board_uart_tx(port: u32, byte: u32);
    fn host_board_lcd_frame(dimensions: u32, pixels: *const u8);
}

/// The wasm build's link: each event is one synchronous import call into the host.
#[cfg(target_arch = "wasm32")]
pub struct WasmLink;
#[cfg(target_arch = "wasm32")]
impl WasmLink {
    fn i2c(op: u32, bus: u8, address: u8, flag: bool, byte: u8) -> u32 {
        let arg = (bus as u32) << I2C_BUS_SHIFT | (address as u32) << I2C_ADDRESS_SHIFT | (flag as u32) << I2C_FLAG_SHIFT | byte as u32;
        // SAFETY: the host import takes two plain integers and has no pointer to validate.
        unsafe { host_board_i2c(op, arg) }
    }
}
#[cfg(target_arch = "wasm32")]
impl HostLink for WasmLink {
    fn gpio(&self, cycle: VirtualCycle, changes: &[(u8, bool)]) {
        let mut records = Vec::with_capacity(changes.len() * GPIO_RECORD_BYTES);
        for &(pin, level) in changes {
            let mut record = [0u8; GPIO_RECORD_BYTES];
            record[..GPIO_PIN_OFFSET].copy_from_slice(&cycle.to_le_bytes());
            record[GPIO_PIN_OFFSET] = pin;
            record[GPIO_LEVEL_OFFSET] = level as u8;
            records.extend_from_slice(&record);
        }
        // SAFETY: the host reads `changes.len()` records from memory that stays valid for this call.
        unsafe { host_board_gpio(records.as_ptr(), changes.len()) }
    }
    fn spi(&self, host: u8, tx: &[u8], rx_len: usize) -> Vec<u8> {
        let request = SPI_HEADER_BYTES + tx.len();
        let mut buffer = vec![0u8; request.max(rx_len)];
        buffer[SPI_HOST_OFFSET] = host;
        buffer[SPI_READ_LENGTH_OFFSET..SPI_HEADER_BYTES].copy_from_slice(&(rx_len as u32).to_le_bytes());
        buffer[SPI_HEADER_BYTES..request].copy_from_slice(tx);
        // SAFETY: the buffer holds the request and room for `rx_len` reply bytes; the host writes the
        // reply from its start and returns how many bytes it wrote.
        let written = unsafe { host_board_spi(buffer.as_mut_ptr(), request) } as usize;
        let mut reply = vec![SPI_IDLE_BYTE; rx_len];
        let count = written.min(rx_len);
        reply[..count].copy_from_slice(&buffer[..count]);
        reply
    }
    fn i2c_start(&self, bus: u8, address: u8, read: bool) -> bool { Self::i2c(OP_START, bus, address, read, 0) != 0 }
    fn i2c_write(&self, bus: u8, byte: u8) -> bool { Self::i2c(OP_WRITE, bus, 0, false, byte) != 0 }
    fn i2c_read(&self, bus: u8) -> u8 { Self::i2c(OP_READ, bus, 0, false, 0) as u8 }
    fn i2c_stop(&self, bus: u8) { Self::i2c(OP_STOP, bus, 0, false, 0); }
    fn uart_tx(&self, port: u8, byte: u8) {
        // SAFETY: the host import takes two plain integers and has no pointer to validate.
        unsafe { host_board_uart_tx(port as u32, byte as u32) }
    }
    fn lcd_frame(&self, w: u32, h: u32, rgb565: &[u8]) {
        let dimensions = w << FRAME_DIMENSION_BITS | h;
        // SAFETY: the host reads `w * h * 2` bytes, which `rgb565` holds, during this call only.
        unsafe { host_board_lcd_frame(dimensions, rgb565.as_ptr()) }
    }
}

/// What the host declared at creation.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct HostSpec {
    pub i2c: Vec<(u8, u8)>,
    pub spi: bool,
    pub uart: bool,
    pub lcd: bool,
}

impl HostSpec {
    pub fn parse(text: &str) -> Result<HostSpec, String> {
        let mut spec = HostSpec::default();
        for pair in text.split(';').map(str::trim).filter(|p| !p.is_empty()) {
            let (key, value) = pair.split_once('=').ok_or_else(|| format!("host board spec: '{pair}' is not key=value"))?;
            match key {
                "i2c" => spec.i2c = Self::addresses(value)?,
                "spi" => spec.spi = Self::flag(value)?,
                "uart" => spec.uart = Self::flag(value)?,
                "lcd" => spec.lcd = Self::flag(value)?,
                _ => return Err(format!("host board spec: unknown key '{key}'")),
            }
        }
        Ok(spec)
    }

    fn flag(value: &str) -> Result<bool, String> {
        match value {
            "0" => Ok(false),
            "1" => Ok(true),
            _ => Err(format!("host board spec: '{value}' is not 0 or 1")),
        }
    }

    fn addresses(value: &str) -> Result<Vec<(u8, u8)>, String> {
        value.split(',').filter(|entry| !entry.is_empty()).map(|entry| {
            let (bus, address) = entry.split_once(':').ok_or_else(|| format!("host board spec: '{entry}' is not BUS:ADDRESS"))?;
            let bus = bus.parse::<u8>().map_err(|_| format!("host board spec: bad bus '{bus}'"))?;
            let address = address.parse::<u8>().ok().filter(|a| *a < 0x80).ok_or_else(|| format!("host board spec: bad address '{address}'"))?;
            Ok((bus, address))
        }).collect()
    }
}

/// RX bytes the host queued for the guest, shared between the board and the emulator handle.
pub type UartQueue = Arc<Mutex<VecDeque<UartInput>>>;

pub struct HostBoard {
    spec: HostSpec,
    link: Rc<dyn HostLink>,
    uart_rx: UartQueue,
    last_cycle: VirtualCycle,
}

impl HostBoard {
    /// The board and the queue `esp32sim_board_uart_input` fills.
    pub fn new(spec: HostSpec, link: Rc<dyn HostLink>) -> (Board, UartQueue) {
        let uart_rx = UartQueue::default();
        (Box::new(HostBoard { spec, link, uart_rx: uart_rx.clone(), last_cycle: 0 }), uart_rx)
    }
}

struct HostI2cDevice {
    bus: u8,
    address: u8,
    link: Rc<dyn HostLink>,
}

impl I2cDevice for HostI2cDevice {
    fn address(&self, _configured: u8) -> u8 { self.address }
    fn start(&mut self, read: bool) -> bool { self.link.i2c_start(self.bus, self.address, read) }
    fn write(&mut self, byte: u8) -> bool { self.link.i2c_write(self.bus, byte) }
    fn read(&mut self) -> u8 { self.link.i2c_read(self.bus) }
    fn stop(&mut self) { self.link.i2c_stop(self.bus) }
}

impl BoardModel for HostBoard {
    fn name(&self) -> &'static str { "host" }
    fn gpio_changes(&mut self, changes: &[(u8, bool)]) {
        if !changes.is_empty() { self.link.gpio(self.last_cycle, changes); }
    }
    fn gpio_output_at(&mut self, cycle: VirtualCycle, changes: &[(u8, bool)], _enabled: u64, _output: u64) {
        self.last_cycle = cycle;
        if !changes.is_empty() { self.link.gpio(cycle, changes); }
    }
    fn advance_to(&mut self, cycle: VirtualCycle) { self.last_cycle = self.last_cycle.max(cycle); }
    fn i2c_devices(&mut self) -> Vec<(u8, u8, Box<dyn I2cDevice>)> {
        self.spec.i2c.iter().map(|&(bus, address)| {
            let device: Box<dyn I2cDevice> = Box::new(HostI2cDevice { bus, address, link: self.link.clone() });
            (bus, address, device)
        }).collect()
    }
    fn spi_transfer(&mut self, host: u8, tx: &[u8], rx_len: usize) -> Vec<u8> {
        if self.spec.spi { self.link.spi(host, tx, rx_len) } else { vec![SPI_IDLE_BYTE; rx_len] }
    }
    fn uses_uart_pins(&self) -> bool { self.spec.uart }
    fn uart_tx(&mut self, _cycle: VirtualCycle, route: UartRoute, byte: u8) {
        if self.spec.uart { self.link.uart_tx(route.port as u8, byte); }
    }
    fn uart_rx(&mut self, _cycle: VirtualCycle) -> Vec<UartInput> {
        self.uart_rx.lock().map(|mut queue| queue.drain(..).collect()).unwrap_or_default()
    }
    fn lcd_frame(&mut self, w: u32, h: u32, rgb565: &[u8]) {
        if self.spec.lcd { self.link.lcd_frame(w, h, rgb565); }
    }
    fn report(&self) -> String { format!("host board: {} I2C address(es)\n", self.spec.i2c.len()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct RecordingLink {
        events: RefCell<Vec<String>>,
        miso: RefCell<Vec<u8>>,
    }

    impl HostLink for RecordingLink {
        fn gpio(&self, cycle: VirtualCycle, changes: &[(u8, bool)]) { self.events.borrow_mut().push(format!("gpio@{cycle} {changes:?}")); }
        fn spi(&self, host: u8, tx: &[u8], rx_len: usize) -> Vec<u8> {
            self.events.borrow_mut().push(format!("spi{host} {tx:?} rx{rx_len}"));
            self.miso.borrow().iter().copied().cycle().take(rx_len).collect()
        }
        fn i2c_start(&self, bus: u8, address: u8, read: bool) -> bool { self.events.borrow_mut().push(format!("i2c{bus} start {address:#x} read={read}")); address == 0x15 }
        fn i2c_write(&self, bus: u8, byte: u8) -> bool { self.events.borrow_mut().push(format!("i2c{bus} write {byte:#x}")); true }
        fn i2c_read(&self, bus: u8) -> u8 { self.events.borrow_mut().push(format!("i2c{bus} read")); 0xa5 }
        fn i2c_stop(&self, bus: u8) { self.events.borrow_mut().push(format!("i2c{bus} stop")); }
        fn uart_tx(&self, port: u8, byte: u8) { self.events.borrow_mut().push(format!("uart{port} tx {byte:#x}")); }
        fn lcd_frame(&self, w: u32, h: u32, rgb565: &[u8]) { self.events.borrow_mut().push(format!("lcd {w}x{h} {}", rgb565.len())); }
    }

    fn board(spec: &str) -> (Board, Rc<RecordingLink>, UartQueue) {
        let link = Rc::new(RecordingLink::default());
        let (board, queue) = HostBoard::new(HostSpec::parse(spec).unwrap(), link.clone());
        (board, link, queue)
    }

    #[test]
    fn a_spec_names_what_the_host_answers_and_refuses_the_rest() {
        let spec = HostSpec::parse("i2c=0:21,1:64;spi=1;uart=1;lcd=0").unwrap();
        assert_eq!(spec, HostSpec { i2c: vec![(0, 21), (1, 64)], spi: true, uart: true, lcd: false });
        assert_eq!(HostSpec::parse("").unwrap(), HostSpec::default());
        for bad in ["x=1", "spi=2", "i2c=0", "i2c=0:128", "i2c=a:1", "spi"] { assert!(HostSpec::parse(bad).is_err(), "{bad}"); }
    }

    #[test]
    fn a_declared_i2c_device_answers_synchronously_through_the_link() {
        let (mut b, link, _) = board("i2c=0:21");
        let mut devices = b.i2c_devices();
        assert_eq!(devices.len(), 1);
        let (bus, address, device) = &mut devices[0];
        assert_eq!((*bus, *address), (0, 21));
        assert!(device.start_address(*address, 21, false));
        assert!(device.write(0x0f));
        assert!(device.start_address(*address, 21, true));
        assert_eq!(device.read(), 0xa5);
        device.stop();
        assert_eq!(*link.events.borrow(), ["i2c0 start 0x15 read=false", "i2c0 write 0xf", "i2c0 start 0x15 read=true", "i2c0 read", "i2c0 stop"]);
    }

    #[test]
    fn an_address_nobody_declared_is_not_on_the_bus() {
        let (mut b, _, _) = board("i2c=0:21");
        assert!(b.i2c_devices().iter().all(|(_, address, _)| *address == 21));
    }

    #[test]
    fn gpio_changes_reach_the_host_before_the_spi_bytes_that_follow_them() {
        let (mut b, link, _) = board("spi=1");
        *link.miso.borrow_mut() = vec![0x11, 0x22];
        b.gpio_output_at(100, &[(4, false)], 0, 0);
        assert_eq!(b.spi_transfer(2, &[0x2a, 0x00], 3), [0x11, 0x22, 0x11]);
        b.gpio_output_at(200, &[(4, true)], 0, 0);
        assert_eq!(b.spi_transfer(2, &[0xff], 0), Vec::<u8>::new());
        assert_eq!(*link.events.borrow(), ["gpio@100 [(4, false)]", "spi2 [42, 0] rx3", "gpio@200 [(4, true)]", "spi2 [255] rx0"]);
    }

    #[test]
    fn what_is_not_declared_stays_with_the_board() {
        let (mut b, link, _) = board("");
        assert_eq!(b.spi_transfer(2, &[1], 2), [0xff, 0xff]);
        b.lcd_frame(2, 1, &[0; 4]);
        assert!(!b.uses_uart_pins());
        assert!(link.events.borrow().is_empty());
    }

    #[test]
    fn lcd_frames_and_uart_bytes_go_to_the_host_when_declared() {
        let (mut b, link, queue) = board("lcd=1;uart=1");
        b.lcd_frame(2, 1, &[0; 4]);
        assert!(b.uses_uart_pins());
        assert_eq!(*link.events.borrow(), ["lcd 2x1 4"]);
        queue.lock().unwrap().push_back(UartInput::new(18, 115_200, vec![0x00, 0x80, 0xff]));
        let received = b.uart_rx(0);
        assert_eq!((received[0].pin, received[0].baud, received[0].data.clone()), (18, 115_200, vec![0x00, 0x80, 0xff]));
        assert!(b.uart_rx(0).is_empty());
    }

    #[test]
    fn uart_input_is_taken_only_when_declared_and_for_a_pin_that_exists() {
        let make = |spec: &str| unsafe { crate::esp32sim_new_host(b"host".as_ptr(), 4, 8, 2, spec.as_ptr(), spec.len()) };
        let feed = |e, pin| unsafe { crate::esp32sim_board_uart_input(e, pin, 115_200, [1u8].as_ptr(), 1) };
        let (without, with) = (make(""), make("uart=1"));
        assert!(!without.is_null() && !with.is_null());
        assert_eq!(feed(without, 18), 1, "uart not declared");
        assert_eq!(feed(with, 18), 0);
        assert_eq!(feed(with, 300), 1, "a pin above 255 is refused, not truncated");
        unsafe { crate::esp32sim_delete(without); crate::esp32sim_delete(with); }
    }
}
