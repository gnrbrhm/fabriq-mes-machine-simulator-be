/**
 * Ic Event Sistemi
 *
 * Simulatorler arasi haberlesme.
 * Ornek: Makine alarm verdiginde job-order simulator duraksar.
 */

type EventHandler = (data: any) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler) {
    this.handlers.get(event)?.delete(handler);
  }

  async emit(event: string, data?: any) {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        await handler(data);
      } catch (err: any) {
        console.error(`[EventBus] ${event} handler hatasi: ${err.message}`);
      }
    }
  }
}

// Event tipleri
export const SimEvents = {
  MACHINE_STATE_CHANGED: 'machine:state_changed',
  PART_PRODUCED: 'machine:part_produced',
  PART_SCRAPPED: 'machine:part_scrapped',
  ALARM_TRIGGERED: 'machine:alarm_triggered',
  ALARM_CLEARED: 'machine:alarm_cleared',
  SHIFT_CHANGED: 'shift:changed',
  SHIFT_BREAK_START: 'shift:break_start',
  SHIFT_BREAK_END: 'shift:break_end',
  MATERIAL_CONSUMED: 'material:consumed',
  MATERIAL_LOW_STOCK: 'material:low_stock',
  MAINTENANCE_NEEDED: 'maintenance:needed',
} as const;
