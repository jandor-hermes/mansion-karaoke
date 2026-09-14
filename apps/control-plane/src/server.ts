import { createBootstrappedControlPlane } from './bootstrap.js';

const token = process.env.KARAOKE_TOKEN;
if (!token) throw new Error('KARAOKE_TOKEN is required');
const plane = createBootstrappedControlPlane({ token, roomId: process.env.KARAOKE_ROOM_ID ?? 'local' });
await plane.listen(Number(process.env.PORT ?? 3010));
console.log(`control-plane listening at ${plane.url}`);
