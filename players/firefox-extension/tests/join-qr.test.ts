import { describe, expect, it, vi } from 'vitest';
import { createJoinQrDataUrl, installJoinQr, JOIN_QR_ID } from '../src/join-qr';
import { createControllerClient } from '../src/index';

describe('TV join QR', () => {
    it('encodes the complete one-scan join URL as an inline image', () => {
        const joinUrl = 'http://192.168.4.31:3010/#token=party-token';
        const image = createJoinQrDataUrl(joinUrl);
        expect(JOIN_QR_ID).toBe('karaoke-join-qr');
        expect(image).toMatch(/^data:image\/(gif|png|svg\+xml)/);
        expect(image.length).toBeGreaterThan(100);
    });

    it('places the card inside the YouTube player so native fullscreen retains it', () => {
        const player = { appendChild: vi.fn((node: any) => { node.parentElement = player; }) };
        const image: any = { style: {}, src: '' };
        const label: any = {};
        const host: any = { style: {}, parentElement: null, setAttribute: vi.fn(), append: vi.fn(), querySelector: () => image };
        const documentLike: any = {
            body: {},
            querySelector: (selector: string) => selector === '.html5-video-player' ? player : null,
            getElementById: () => null,
            createElement: (tag: string) => tag === 'div' ? host : tag === 'img' ? image : label,
        };
        installJoinQr(documentLike, 'http://192.168.4.31:3010/#token=party-token');
        expect(host.id).toBe(JOIN_QR_ID);
        expect(player.appendChild).toHaveBeenCalledWith(host);
        expect(image.src).toMatch(/^data:image\//);
    });

    it('retrieves join info using the configured bearer token', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ joinUrl: 'http://192.168.4.31:3010/#token=party-token' }), { status: 200 }));
        const client = createControllerClient({ baseUrl: 'http://127.0.0.1:3010', token: 'party-token', fetcher });
        await expect(client.joinInfo()).resolves.toEqual({ joinUrl: 'http://192.168.4.31:3010/#token=party-token' });
        expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3010/join-info', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer party-token' }) }));
    });
});