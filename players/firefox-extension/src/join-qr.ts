import qrcode from 'qrcode-generator';

export const JOIN_QR_ID = 'karaoke-join-qr';

export function createJoinQrDataUrl(joinUrl: string): string {
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();
    return qr.createDataURL(4, 2);
}

export function installJoinQr(documentLike: Document, joinUrl: string): HTMLElement | null {
    const parent = documentLike.querySelector('.html5-video-player') ?? documentLike.body;
    if (!parent) return null;

    let host = documentLike.getElementById(JOIN_QR_ID) as HTMLElement | null;
    if (!host) {
        host = documentLike.createElement('div');
        host.id = JOIN_QR_ID;
        host.setAttribute('aria-label', 'Scan to join the karaoke queue');
        host.style.cssText = 'position:absolute;top:18px;right:18px;z-index:2147483647;width:132px;padding:8px;border-radius:10px;background:rgba(255,255,255,.94);color:#111;text-align:center;font:700 12px/1.2 -apple-system,system-ui,sans-serif;box-shadow:0 3px 14px rgba(0,0,0,.5);pointer-events:none;';
        const image = documentLike.createElement('img');
        image.alt = '';
        image.width = 116;
        image.height = 116;
        image.style.cssText = 'display:block;width:116px;height:116px;margin:0 auto 5px;image-rendering:pixelated;';
        const label = documentLike.createElement('div');
        label.textContent = 'Scan to join';
        host.append(image, label);
    }
    const image = host.querySelector('img');
    if (image) image.src = createJoinQrDataUrl(joinUrl);
    if (host.parentElement !== parent) parent.appendChild(host);
    return host;
}
