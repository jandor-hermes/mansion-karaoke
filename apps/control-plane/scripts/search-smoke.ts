import { createConfiguredYoutubeSearchAdapter } from '../src/youtube-search.js';

const query = process.argv.slice(2).join(' ') || 'karaoke';
if (!process.env.YOUTUBE_API_KEY && !process.env.INNERTUBE_API_KEY) {
  console.log('SKIP: set YOUTUBE_API_KEY or INNERTUBE_API_KEY to run search smoke');
  process.exit(0);
}
try {
  const page = await createConfiguredYoutubeSearchAdapter().search(query);
  console.log(JSON.stringify(page, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
