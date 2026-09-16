/* global browser */
import { installJoinQr } from './join-qr';

async function installDisplay() {
    const status = document.getElementById('display-status');
    try {
        const value = await browser.runtime.sendMessage({ type: 'getJoinInfo' });
        if (!value || typeof value !== 'object' || typeof (value as { joinUrl?: unknown }).joinUrl !== 'string') throw new Error('Join information unavailable');
        installJoinQr(document, (value as { joinUrl: string }).joinUrl);
        if (status) status.textContent = 'Scan the QR code to join, then add a song.';
    } catch (error) {
        if (status) status.textContent = 'Could not load join information. Check the controller settings.';
        console.error('[karaoke-player] display join QR unavailable', error);
    }
}

void installDisplay();
