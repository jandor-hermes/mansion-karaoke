declare const browser: {
    tabs: {
        get(id: number): Promise<unknown>;
        create(options: { url: string; active: boolean }): Promise<{ id?: number }>;
        update(id: number, options: { url: string; active: boolean }): Promise<unknown>;
        sendMessage(tabId: number, message: unknown): Promise<unknown>;
        onRemoved: { addListener(listener: (tabId: number) => void): void };
    };
    runtime: { sendMessage(message: unknown): Promise<unknown>; onMessage: { addListener(listener: (message: unknown) => void): void } };
};
