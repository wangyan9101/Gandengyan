/** Implemented by a later platform adapter. No socket, timer, DOM or Node dependency here. */
export interface RequestTransport {
  request(encodedMessage: string): Promise<unknown>;
}
