import { loadConfig } from './src/config-schema.js';
import { enrichMessageWithDocs } from './src/features/doc-parser.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npx tsx parse-doc-temp.mts <url>');
  process.exit(1);
}

const cfg = loadConfig();
const result = await enrichMessageWithDocs(cfg, url);
console.log(JSON.stringify(result, null, 2));
