import { Client } from 'youtubei';
import { createBootstrappedControlPlane } from './bootstrap.js';
import { lanIPv4Addresses, resolveBindAddress } from './index.js';

const token = process.env.KARAOKE_TOKEN;
if (!token) throw new Error('KARAOKE_TOKEN is required');

const port = Number(process.env.PORT ?? 3010);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');

const youtubeiClient = new Client({ oauth: { enabled: false } });
const plane = createBootstrappedControlPlane({
  token,
  roomId: process.env.KARAOKE_ROOM_ID ?? 'local',
  youtubeiClient,
});

await plane.listen(port);
console.log(`control-plane listening at ${plane.url} (bind ${resolveBindAddress(process.env)})`);
for (const address of lanIPv4Addresses()) {
  console.log(`guest UI (phones on this Wi-Fi): http://${address}:${port}/ — token: shared party secret`);
}
