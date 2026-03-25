import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'fs';

// Read config 
const configPath = '/home/ubuntu/.clawdbot/config.yaml';
const configContent = fs.readFileSync(configPath, 'utf8');

// Simple YAML parsing
const appIdMatch = configContent.match(/appId:\s*["']?([^"'\n]+)["']?/);
const appSecretMatch = configContent.match(/appSecret:\s*["']?([^"'\n]+)["']?/);

if (!appIdMatch || !appSecretMatch) {
  console.error('Cannot find feishu credentials');
  process.exit(1);
}

const client = new lark.Client({
  appId: appIdMatch[1].trim(),
  appSecret: appSecretMatch[1].trim(),
  disableTokenCache: false,
});

const token = 'I9assCeeghegmXtXdgdcajPIn0e';
const range = 'a4585c!A687:AZ800';

const resp = await client.sheets.spreadsheetSheetValues.get({
  path: {
    spreadsheet_token: token,
    range: range
  }
});

console.log(JSON.stringify(resp.data, null, 2));
