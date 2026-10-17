// Узкая поверхность ws: только используемые здесь методы.
declare module 'ws' {
  import { EventEmitter } from 'node:events'
  import type { IncomingMessage } from 'node:http'
  import type { Duplex } from 'node:stream'
  export default class WebSocket extends EventEmitter {
    constructor(url: string, options?: { headers?: Record<string, string>; handshakeTimeout?: number; maxPayload?: number })
    readyState: number
    bufferedAmount: number
    send(data: string | Uint8Array, options?: { binary: boolean }): void
    close(code?: number, reason?: string): void
    terminate(): void
  }
  export class WebSocketServer extends EventEmitter {
    constructor(options: { noServer: boolean; maxPayload: number; perMessageDeflate: boolean })
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, callback: (ws: WebSocket) => void): void
    close(): void
  }
}
