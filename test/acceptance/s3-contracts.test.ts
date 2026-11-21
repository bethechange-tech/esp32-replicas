import { BacklightHelper, Gt911 } from "@replicas/devices";
import { I2cDeviceContract } from "../contracts/i2c-device.contract";

const TOUCH_ADDRESS = 0x5d;
const HELPER_ADDRESS = 0x30;
const ON_COMMAND = 0x10;
const COLUMNS = 800;
const ROWS = 480;
const TOUCH_STATE_HIGH = 0x81;
const MAX_VALUES_HIGH = 0x80;
const BURST_BYTES = 8;
const HELPER_REGISTER = 0x00;
const HELPER_LENGTH = 1;

I2cDeviceContract.register({
  name: "Gt911 at its touch registers",
  make: () => ({ device: new Gt911({ address: TOUCH_ADDRESS, columns: COLUMNS, rows: ROWS }), register: TOUCH_STATE_HIGH, length: BURST_BYTES }),
});

I2cDeviceContract.register({
  name: "Gt911 at its configuration registers",
  make: () => ({ device: new Gt911({ address: TOUCH_ADDRESS, columns: COLUMNS, rows: ROWS }), register: MAX_VALUES_HIGH, length: BURST_BYTES }),
});

I2cDeviceContract.register({
  name: "BacklightHelper",
  make: () => ({ device: new BacklightHelper({ address: HELPER_ADDRESS, onCommand: ON_COMMAND }), register: HELPER_REGISTER, length: HELPER_LENGTH }),
});
