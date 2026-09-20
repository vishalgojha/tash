import 'dotenv/config';
import { boot } from './api/server.js';

boot().catch((e) => {
  console.error('boot failed:', e.message);
  process.exit(1);
});