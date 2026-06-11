import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { rewriteJsonRpcPayload } from "./rewrite.js";
import { writeStatusForServerPayload } from "./status.js";
import {
  formatEventError,
  trace,
  traceClientMessage,
  traceServerMessage
} from "./trace.js";

export {
  extractPromptText,
  rewriteJsonRpcMessage,
  rewriteJsonRpcPayload
} from "./rewrite.js";
export { writeStatusForServerPayload } from "./status.js";
export { summarizeServerMessage } from "./trace.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
let nextConnectionId = 1;

export async function startRemoteProxy(options = {}) {
  if (typeof WebSocket !== "function") {
    throw new Error("codex-shift proxy requires a Node.js runtime with built-in WebSocket support.");
  }

  const listen = parseWsUrl(options.listen ?? "ws://127.0.0.1:0", "listen");
  const target = parseWsUrl(options.target, "target");
  const server = createServer();

  server.on("clientError", (_error, socket) => {
    trace(options, "server clientError");
    socket.destroy();
  });

  server.on("upgrade", (request, socket, head) => {
    try {
      acceptWebSocketUpgrade(request, socket);
      const client = new WebSocketConnection(socket);
      attachRelay(client, target.href, {
        ...options,
        connectionId: nextConnectionId++
      });
      if (head?.length) client.pushData(head);
    } catch (error) {
      trace(options, `upgrade failed: ${error.message}`);
      socket.destroy(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen.port, listen.hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : listen.port;
  const url = `ws://${listen.hostname}:${port}`;

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    server,
    target: target.href,
    url
  };
}

function attachRelay(client, targetUrl, options) {
  const target = new WebSocket(targetUrl);
  target.binaryType = "arraybuffer";
  const pending = [];
  const label = `conn=${options.connectionId ?? "-"}`;
  let targetOpen = false;
  let closed = false;

  trace(options, `${label} client connected`);

  const closeBoth = (reason = "close") => {
    if (closed) return;
    closed = true;
    trace(options, `${label} closing relay: ${reason}`);
    client.close();
    try {
      target.close();
    } catch {
      // Target may already be closed.
    }
  };

  target.addEventListener("open", () => {
    targetOpen = true;
    trace(options, `${label} target open`);
    while (pending.length) {
      target.send(pending.shift());
    }
  });

  target.addEventListener("message", (event) => {
    const { payload, binary } = normalizeTargetPayload(event.data);
    if (!binary) {
      traceServerMessage(payload, options, label);
      writeStatusForServerPayload(payload, options);
    }
    client.send(payload, { binary });
  });

  target.addEventListener("close", () => closeBoth("target close"));
  target.addEventListener("error", (event) => {
    trace(options, `${label} target error ${formatEventError(event)}`);
    closeBoth("target error");
  });

  client.on("message", ({ data, binary }) => {
    let payload = data;
    if (!binary) {
      traceClientMessage(data, options, label);
      payload = rewriteJsonRpcPayload(data, options).payload;
    }

    if (targetOpen) target.send(payload);
    else pending.push(payload);
  });

  client.on("close", () => closeBoth("client close"));
  client.on("error", (error) => {
    trace(options, `${label} client error ${error.message}`);
    closeBoth("client error");
  });
}

function acceptWebSocketUpgrade(request, socket) {
  const key = request.headers["sec-websocket-key"];
  if (!key) throw new Error("Missing Sec-WebSocket-Key.");

  const accept = createHash("sha1")
    .update(`${key}${WS_GUID}`)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ].join("\r\n"));
}

function parseWsUrl(value, label) {
  if (!value) throw new Error(`Missing --${label}.`);
  const url = new URL(value);
  if (url.protocol !== "ws:") {
    throw new Error(`Unsupported ${label} URL ${value}. Only ws:// is supported in this preview.`);
  }
  if (!url.hostname || !url.port) {
    throw new Error(`${label} URL must include host and port.`);
  }
  return url;
}

function normalizeTargetPayload(data) {
  if (typeof data === "string") return { payload: data, binary: false };
  if (data instanceof ArrayBuffer) return { payload: Buffer.from(data), binary: true };
  if (ArrayBuffer.isView(data)) {
    return {
      payload: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      binary: true
    };
  }
  return { payload: String(data ?? ""), binary: false };
}

class WebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.fragmented = null;
    this.socket = socket;

    socket.on("data", (chunk) => this.pushData(chunk));
    socket.on("close", () => {
      this.closed = true;
      this.emit("close");
    });
    socket.on("error", (error) => this.emit("error", error));
  }

  pushData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.readFrames();
  }

  send(data, options = {}) {
    if (this.closed || this.socket.destroyed) return;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    this.socket.write(encodeFrame(payload, options.binary ? 0x2 : 0x1));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.write(encodeFrame(Buffer.alloc(0), 0x8));
    } catch {
      // Socket may already be gone.
    }
    this.socket.end();
  }

  readFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const bigLength = this.buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.close();
          return;
        }
        length = Number(bigLength);
        offset += 8;
      }

      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;

      const mask = masked ? this.buffer.subarray(maskOffset, maskOffset + 4) : null;
      let payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);

      if (masked) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }

      this.handleFrame({ fin, opcode, payload });
    }
  }

  handleFrame(frame) {
    if (frame.opcode === 0x8) {
      this.close();
      return;
    }
    if (frame.opcode === 0x9) {
      this.socket.write(encodeFrame(frame.payload, 0xA));
      return;
    }
    if (frame.opcode === 0xA) return;

    if (frame.opcode === 0x0 && this.fragmented) {
      this.fragmented.parts.push(frame.payload);
      if (frame.fin) {
        const payload = Buffer.concat(this.fragmented.parts);
        const opcode = this.fragmented.opcode;
        this.fragmented = null;
        this.emitMessage(opcode, payload);
      }
      return;
    }

    if (frame.opcode === 0x1 || frame.opcode === 0x2) {
      if (!frame.fin) {
        this.fragmented = { opcode: frame.opcode, parts: [frame.payload] };
        return;
      }
      this.emitMessage(frame.opcode, frame.payload);
    }
  }

  emitMessage(opcode, payload) {
    if (opcode === 0x1) {
      this.emit("message", { data: payload.toString("utf8"), binary: false });
    } else if (opcode === 0x2) {
      this.emit("message", { data: payload, binary: true });
    }
  }
}

function encodeFrame(payload, opcode) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}
