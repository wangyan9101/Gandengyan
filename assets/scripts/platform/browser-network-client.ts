import { SocketNetworkClient, type NetworkClient } from '../generated/remote/index';

/** Browser preview adapter. WeChat transport is a later platform adapter. */
export function createBrowserNetworkClient(): NetworkClient {
  return new SocketNetworkClient((url, handlers) => {
    const socket = new WebSocket(url);
    socket.onmessage = (event: MessageEvent<unknown>) => handlers.message(event.data);
    socket.onclose = (event: CloseEvent) => handlers.close(event.code);
    socket.onerror = () => handlers.error();
    return { send: (data) => socket.send(data), close: () => socket.close() };
  }, (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  });
}
