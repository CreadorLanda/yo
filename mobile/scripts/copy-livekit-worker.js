// The browser loads LiveKit's E2EE worker as its own script, and Metro does
// not bundle `new Worker(new URL(...))`. Copy it from the installed package
// into `public/` so it always matches the `livekit-client` that is bundled.
const fs = require('fs');
const path = require('path');

const root = path.resolve(path.dirname(process.argv[1]), '..');
const from = path.join(
  root,
  'node_modules',
  'livekit-client',
  'dist',
  'livekit-client.e2ee.worker.js',
);
const to = path.join(root, 'public', 'livekit-e2ee-worker.js');

fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
