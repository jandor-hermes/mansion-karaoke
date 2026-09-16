import { createVkaraInnertubeSearchAdapter, type InnertubeClientLike } from '../src/youtube-search.js';

const fixture = { contents: { sectionListRenderer: { contents: [{ videoRenderer: { videoId: 'fixture-video', title: { simpleText: 'Fixture search result' } } }] } } };
const client: InnertubeClientLike = { http: { post: async () => ({ data: fixture }) } };
const query = process.argv.slice(2).join(' ') || 'karaoke';
const page = await createVkaraInnertubeSearchAdapter(client).search(query);
console.log(JSON.stringify({ mode: 'no-key-fixture', query, page }, null, 2));
console.log('SKIP: live YouTube search is intentionally not exercised');
