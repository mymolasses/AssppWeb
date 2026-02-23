declare module 'cloudflare:containers' {
  import { DurableObject } from 'cloudflare:workers';

  export class Container extends DurableObject {
    defaultPort?: number;
    requiredPorts?: number[];
    sleepAfter?: string;
    enableInternet?: boolean;
    pingEndpoint?: string;
    envVars?: Record<string, string>;
    entrypoint?: string[];
  }
}
