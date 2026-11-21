/** Record layouts and packings of the host-board imports. `wire` in `host_board.rs` holds the same numbers; a test asserts they match. */
export class HostWire {
  static readonly GPIO_RECORD_BYTES = 16;
  static readonly GPIO_PIN_OFFSET = 8;
  static readonly GPIO_LEVEL_OFFSET = 9;
  static readonly SPI_HEADER_BYTES = 8;
  static readonly SPI_HOST_OFFSET = 0;
  static readonly SPI_READ_LENGTH_OFFSET = 4;
  static readonly FRAME_DIMENSION_BITS = 16;
  static readonly I2C_BUS_SHIFT = 24;
  static readonly I2C_ADDRESS_SHIFT = 16;
  static readonly I2C_FLAG_SHIFT = 8;
  static readonly OP_START = 0;
  static readonly OP_WRITE = 1;
  static readonly OP_READ = 2;
  static readonly OP_STOP = 3;
  static readonly BYTE_MASK = 0xff;
  static readonly RGB565_BYTES = 2;

  private constructor() {}
}
