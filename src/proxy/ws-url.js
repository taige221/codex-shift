export function parseWsUrl(value, label) {
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

export function buildListenUrl(listen, address) {
  const port = typeof address === "object" && address ? address.port : listen.port;
  return `ws://${listen.hostname}:${port}`;
}
