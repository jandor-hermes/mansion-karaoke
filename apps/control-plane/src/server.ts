import { createBootstrappedControlPlane } from './bootstrap.js';
import { autoKjStartupDefault, defaultAutoKjStateFile, lanIPv4Addresses, resolveBindAddress } from './index.js';

const token = process.env.KARAOKE_TOKEN;
if (!token) throw new Error('KARAOKE_TOKEN is required');
const plane = createBootstrappedControlPlane({
  token,
  roomId: process.env.KARAOKE_ROOM_ID ?? 'local',
  autoKjEnabled: autoKjStartupDefault(process.env),
  autoKjStateFile: defaultAutoKjStateFile(process.env),
});
await plane.listen(Number(process.env.PORT ?? 3010));
const port = Number(new URL(plane.url).port);
console.log(`control-plane listening at ${plane.url} (bind ${resolveBindAddress(process.env)})`);
if (!autoKjStartupDefault(process.env)) console.log('Auto-KJ disabled by KARAOKE_AUTO_KJ=off — new songs append to the end (the host toggle in Controls can re-enable it).');
for (const address of lanIPv4Addresses()) console.log(`guest UI (phones on this Wi-Fi): http://${address}:${port}/ — token: shared party secret`);
