import type { Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { RealtimeEvent, RealtimeMessage, SyncEntity } from '@pos/shared'
import { authenticate, type DeviceRecord } from './auth.ts'

/**
 * The realtime channel.
 *
 * Devices hold an authenticated socket and receive a short notice whenever the
 * server accepts a change: what kind of change it was, and the sequence number
 * to catch up to. The notice carries no business data, so nothing sensitive is
 * broadcast to a terminal that is not entitled to it - the device then pulls
 * through the ordinary authenticated sync endpoint.
 *
 * A dropped socket is never a correctness problem. It only costs latency,
 * because the sync engine also polls, and a device that reconnects simply
 * pulls from its stored cursor.
 */

interface Client {
  socket: WebSocket
  device: DeviceRecord
  alive: boolean
}

const clients = new Set<Client>()

const ENTITY_EVENTS: Partial<Record<SyncEntity, RealtimeEvent>> = {
  sales: 'SALE_CREATED',
  saleItems: 'SALE_CREATED',
  saleDiscounts: 'SALE_CREATED',
  payments: 'SALE_CREATED',
  inventoryMovements: 'INVENTORY_CHANGED',
  products: 'PRODUCT_UPDATED',
  productVariants: 'PRICE_UPDATED',
  recipes: 'RECIPE_UPDATED',
  recipeIngredients: 'RECIPE_UPDATED',
  ingredients: 'INVENTORY_CHANGED',
  users: 'STAFF_UPDATED',
  shifts: 'SHIFT_STARTED',
  registerReadings: 'X_READING_CREATED',
  settings: 'SETTINGS_UPDATED',
  devices: 'DEVICE_UPDATED',
  categories: 'PRODUCT_UPDATED',
  modifierGroups: 'PRODUCT_UPDATED',
  modifierOptions: 'PRODUCT_UPDATED',
  suppliers: 'INVENTORY_CHANGED',
  cashMovements: 'SHIFT_ENDED',
  auditLogs: 'SYNC_CURSOR_ADVANCED',
}

export function eventForEntity(entity: SyncEntity): RealtimeEvent {
  return ENTITY_EVENTS[entity] ?? 'SYNC_CURSOR_ADVANCED'
}

export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname !== '/realtime') {
      socket.destroy()
      return
    }

    // The token travels as a query parameter because browser WebSocket clients
    // cannot set an Authorization header.
    let device: DeviceRecord
    try {
      device = authenticate(url.searchParams.get('token'))
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const client: Client = { socket: ws, device, alive: true }
      clients.add(client)

      ws.on('pong', () => {
        client.alive = true
      })
      ws.on('message', (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as { type?: string }
          if (message.type === 'PING') {
            ws.send(JSON.stringify({ type: 'PONG', at: Date.now() }))
          }
        } catch {
          // A malformed frame is ignored; it can never corrupt server state.
        }
      })
      ws.on('close', () => clients.delete(client))
      ws.on('error', () => clients.delete(client))

      ws.send(JSON.stringify({ type: 'READY', serverSeq: currentSeq() }))
    })
  })

  // Drop sockets that have stopped answering, so a device that vanished does
  // not linger in the connected count on the sync dashboard.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate()
        clients.delete(client)
        continue
      }
      client.alive = false
      try {
        client.socket.ping()
      } catch {
        clients.delete(client)
      }
    }
  }, 30_000)
  heartbeat.unref?.()
}

let currentSeq: () => number = () => 0

export function setSeqSource(source: () => number): void {
  currentSeq = source
}

export function broadcast(message: RealtimeMessage): void {
  const payload = JSON.stringify(message)
  for (const client of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue
    try {
      client.socket.send(payload)
    } catch {
      clients.delete(client)
    }
  }
}

/** Collapse a synced batch into one notice per kind of change. */
export function broadcastBatch(
  entities: Array<{ entity: SyncEntity; entityId: string }>,
  seq: number,
  originDeviceId: string,
): void {
  const seen = new Map<RealtimeEvent, string>()
  for (const item of entities) {
    const event = eventForEntity(item.entity)
    if (!seen.has(event)) seen.set(event, item.entityId)
  }
  const at = Date.now()
  for (const [type, entityId] of seen) {
    broadcast({ type, seq, originDeviceId, entity: null, entityId, at })
  }
}

export function connectedDeviceIds(): string[] {
  return [...new Set([...clients].map((client) => client.device.deviceId))]
}

export function connectionCount(): number {
  return clients.size
}
