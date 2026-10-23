/**
 * Enttec DMX USB Pro via Web Serial API (Chrome / Edge).
 * Protocol: https://www.enttec.com/docs/dmx_usb_pro_api_spec.pdf
 */

const ENTTEC_START = 0x7e;
const ENTTEC_END = 0xe7;
const LABEL_SEND_DMX = 0x06;
const BAUD = 57600;
const CHANNEL_COUNT = 512;

export class EnttecDmxPro {
  /** @type {SerialPort | null} */
  #port = null;
  /** @type {WritableStreamDefaultWriter<Uint8Array> | null} */
  #writer = null;
  #universe = new Uint8Array(CHANNEL_COUNT);
  /** @type {ReturnType<typeof setInterval> | null} */
  #timer = null;
  #fps = 40;

  get connected() {
    return this.#port != null;
  }

  get universe() {
    return this.#universe;
  }

  async connect() {
    if (!("serial" in navigator)) {
      throw new Error("Web Serial is not supported in this browser. Use Chrome or Edge.");
    }

    const port = await navigator.serial.requestPort();
    await port.open({
      baudRate: BAUD,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });

    if (!port.writable) {
      await port.close();
      throw new Error("Serial port is not writable.");
    }

    this.#port = port;
    this.#writer = port.writable.getWriter();
    this.#startRefresh();
  }

  async disconnect() {
    this.#stopRefresh();

    if (this.#writer) {
      try {
        this.#writer.releaseLock();
      } catch {
        // ignore
      }
      this.#writer = null;
    }

    if (this.#port) {
      try {
        await this.#port.close();
      } catch {
        // ignore
      }
      this.#port = null;
    }
  }

  setChannel(channel, value) {
    if (channel < 1 || channel > CHANNEL_COUNT) return;
    this.#universe[channel - 1] = clampByte(value);
  }

  setChannels(values, startChannel = 1) {
    for (let i = 0; i < values.length; i++) {
      this.setChannel(startChannel + i, values[i]);
    }
  }

  blackout() {
    this.#universe.fill(0);
  }

  #startRefresh() {
    this.#stopRefresh();
    const interval = 1000 / this.#fps;
    this.#timer = setInterval(() => {
      void this.#sendFrame();
    }, interval);
  }

  #stopRefresh() {
    if (this.#timer != null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #sendFrame() {
    if (!this.#writer) return;

    const dataLen = CHANNEL_COUNT + 1; // start code + 512 channels
    const packet = new Uint8Array(5 + dataLen);
    packet[0] = ENTTEC_START;
    packet[1] = LABEL_SEND_DMX;
    packet[2] = dataLen & 0xff;
    packet[3] = (dataLen >> 8) & 0xff;
    packet[4] = 0x00; // DMX start code
    packet.set(this.#universe, 5);
    packet[4 + dataLen] = ENTTEC_END;

    try {
      await this.#writer.write(packet);
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value | 0));
}
