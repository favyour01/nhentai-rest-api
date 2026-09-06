import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './routes/api.js';
import backfillRouter from './routes/backfill.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security & CORS
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 300, // 300 request per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);
app.use('/v2/', limiter);

// Static files (landing page & docs)
app.use(express.static(join(__dirname, '..', 'public')));

// API Routes
app.use('/api/v2', apiRouter);
app.use('/v2', apiRouter); // Alias

// Backfill routes
app.use('/api/v2/backfill', backfillRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});

// Landing page (root)
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

// Docs page
app.get('/docs', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'docs.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 nhentai REST API v2 running on port ${PORT}`);
  console.log(`📖 Docs: http://localhost:${PORT}/docs`);
  console.log(`🏠 Landing: http://localhost:${PORT}/`);
});

export default app;
