import { WebSocket as NodeWsWebSocket, type RawData } from "ws";
import {
  createRealtimeSocketAdapter,
  wrapStandardWebsocket,
} from "./realtime-client.js";
import type { BbRealtimeSocket, BbRealtimeSocketFactory } from "./transport.js";

function decodeWsMessageData(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}

export function wrapNodeWsWebsocket(
  url: string,
  headers?: Record<string, string>,
): BbRealtimeSocket {
  const socket =
    headers === undefined
      ? new NodeWsWebSocket(url)
      : new NodeWsWebSocket(url, { headers });
  const adapter = createRealtimeSocketAdapter(socket);
  socket.on("open", () => adapter.onopen?.());
  socket.on("message", (data) =>
    adapter.onmessage?.({ data: decodeWsMessageData(data) }),
  );
  socket.on("close", () => adapter.onclose?.());
  socket.on("error", () => adapter.onerror?.());
  return adapter;
}

export function createNodeWebsocketFactory(
  options: { headers?: Record<string, string> } = {},
): BbRealtimeSocketFactory {
  const headers =
    options.headers !== undefined && Object.keys(options.headers).length > 0
      ? options.headers
      : undefined;
  return (url) => {
    if (headers !== undefined) {
      return wrapNodeWsWebsocket(url, headers);
    }
    if (typeof WebSocket !== "undefined") {
      return wrapStandardWebsocket(new WebSocket(url));
    }
    return wrapNodeWsWebsocket(url);
  };
}
