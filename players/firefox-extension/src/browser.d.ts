declare const browser: {
    windows: { update(id: number, options: { state: 'fullscreen' }): Promise<unknown> };
    tabs: {
        get(id: number): Promise<{ id?: number; windowId?: number }>;
        create(options: { url: string; active: boolean }): Promise<{ id?: number; windowId?: number }>;
        update(id: number, options: { url: string; active: boolean }): Promise<unknown>;
        sendMessage(tabId: number, message: unknown): Promise<unknown>;
        onRemoved: { addListener(listener: (tabId: number) => void): void };
    };
    runtime: { getURL(path: string): string; sendMessage(message: unknown): Promise<unknown>; onMessage: { addListener(listener: (message: unknown) => unknown): void } };
    storage: { local: { get(keys?: string[]): Promise<unknown>; set(items: Record<string, unknown>): Promise<void> }; onChanged?: { addListener(listener: (changes: Record<string, { newValue?: unknown }>) => void): void } };
};
