import { Cst816, Ina226, PowerLatch } from "@replicas/devices";
import { GpioWatcherContract } from "../contracts/gpio-watcher.contract";
import { I2cDeviceContract } from "../contracts/i2c-device.contract";
import { RegisterFileI2cDevice } from "../fakes/register-file-i2c-device";

const TOUCH_ADDRESS = 0x15;
const MONITOR_ADDRESS = 0x40;
const FAKE_ADDRESS = 0x50;
const INTERRUPT_GPIO = 14;
const RESET_GPIO = 13;
const CHIP_ID_REGISTER = 0xa7;
const BUS_VOLTAGE_REGISTER = 0x02;
const STATUS_REGISTER = 0x00;
const BURST_BYTES = 13;
const WORD_BYTES = 2;

I2cDeviceContract.register({
  name: "Cst816",
  make: () => ({ device: new Cst816({ address: TOUCH_ADDRESS, interruptGpio: INTERRUPT_GPIO, resetGpio: RESET_GPIO }), register: STATUS_REGISTER, length: BURST_BYTES }),
});

I2cDeviceContract.register({
  name: "Cst816 at its chip ID",
  make: () => ({ device: new Cst816({ address: TOUCH_ADDRESS, interruptGpio: INTERRUPT_GPIO, resetGpio: RESET_GPIO }), register: CHIP_ID_REGISTER, length: 1 }),
});

I2cDeviceContract.register({
  name: "Ina226",
  make: () => ({ device: new Ina226(MONITOR_ADDRESS), register: BUS_VOLTAGE_REGISTER, length: WORD_BYTES }),
});

I2cDeviceContract.register({
  name: "RegisterFileI2cDevice",
  make: () => ({ device: new RegisterFileI2cDevice(FAKE_ADDRESS), register: STATUS_REGISTER, length: BURST_BYTES }),
});

const LATCH_GPIO = 41;
const UNWATCHED_GPIO = 3;
const LANDED = { x: 5, y: 6 };

GpioWatcherContract.register({
  name: "PowerLatch",
  make: () => {
    const watcher = new PowerLatch(LATCH_GPIO);
    watcher.onEdges([{ gpio: LATCH_GPIO, level: true, atCycle: 0 }]);
    return { watcher, otherGpio: UNWATCHED_GPIO, observed: () => [watcher.holdsPower(), watcher.changedAtCycle()] };
  },
});

GpioWatcherContract.register({
  name: "Cst816",
  make: () => {
    const watcher = new Cst816({ address: TOUCH_ADDRESS, interruptGpio: INTERRUPT_GPIO, resetGpio: RESET_GPIO });
    watcher.place(LANDED);
    return { watcher, otherGpio: UNWATCHED_GPIO, observed: () => [watcher.isTouched(), watcher.irqControl()] };
  },
});
