/**
 * Putting the API on a port.
 *
 * Every interface (`0.0.0.0`), never only localhost: Clever Cloud checks that
 * something answers on port 8080 on a public interface before it sends traffic,
 * and fails the deploy otherwise.
 */
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import type { AddressInfo } from 'node:net';

export interface Listening {
  address: string;
  port: number;
  /** Stops accepting connections and waits for the open ones to finish. */
  close(): Promise<void>;
}

export function listen(app: Hono, port: number): Promise<Listening> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info: AddressInfo) => {
      server.off('error', reject);
      resolve({
        address: info.address,
        port: info.port,
        close: () =>
          new Promise<void>((closed, failed) => {
            server.close((error) => {
              if (error === undefined) {
                closed();
              } else {
                failed(error);
              }
            });
          }),
      });
    });
    // A port already in use is reported here, not thrown: without this the
    // promise would never settle and the process would sit there, not
    // listening, looking started.
    server.once('error', reject);
  });
}
