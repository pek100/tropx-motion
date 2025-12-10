import { config } from 'dotenv';
import { resolve } from 'path';
import { app } from 'electron';

// Load .env.local from project root (before app ready)
const envPath = app.isPackaged
  ? resolve(process.resourcesPath, '.env.local')
  : resolve(__dirname, '../../..', '.env.local');

config({ path: envPath });

console.log('[Main] Loaded env from:', envPath);
console.log('[Main] VITE_CONVEX_URL:', process.env.VITE_CONVEX_URL ? 'set' : 'NOT SET');

import { MainProcess } from './MainProcess';

// Create and start the Electron app
new MainProcess();