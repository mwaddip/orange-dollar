import express from 'express';
import cors from 'cors';
import { loadConfig } from './config.js';
import { cabalRouter } from './routes/cabal.js';

const config = loadConfig();
const app = express();

const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS']
  ? process.env['ALLOWED_ORIGINS'].split(',')
  : ['https://app.odol.cash', 'https://cabal.odol.cash'];
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());
app.use('/api/cabal', cabalRouter(config));

app.listen(config.port, () => {
  console.log(`CABAL server listening on port ${config.port}`);
});
