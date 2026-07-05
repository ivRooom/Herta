type EventHandler = (payload: unknown) => Promise<void>;

/** Plugin 間通信用の EventBus */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /** イベントを発火する */
  async emit(eventName: string, payload: unknown): Promise<void> {
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;

    const promises = [...handlers].map((handler) =>
      handler(payload).catch((error) => {
        console.error(`EventBus handler error for "${eventName}":`, error);
      }),
    );
    await Promise.allSettled(promises);
  }

  /** イベントを購読する */
  subscribe(eventName: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventName) ?? new Set();
    handlers.add(handler);
    this.handlers.set(eventName, handlers);
  }

  /** イベントの購読を解除する */
  unsubscribe(eventName: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.handlers.delete(eventName);
    }
  }

  /** 全ての購読を解除する */
  clear(): void {
    this.handlers.clear();
  }
}
