import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth';
import producerRoutes from './routes/producer';
import quotesRoutes from './routes/quotes';
import adminRoutes from './routes/admin';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS
const allowedOrigins = [
  'http://localhost:3000',   // Next.js admin
  'http://localhost:8081',   // Expo web
  'http://localhost:8082',   // Expo web (alternate port)
  'http://localhost:19006',  // Expo web (legacy)
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : []),
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Request Logger ─────────────────────────────────────────────────────────
// Logs every request with method, path, status, duration, and body (for POST/PUT/PATCH)
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  // Log request
  const bodyPreview = ['POST', 'PUT', 'PATCH'].includes(method) && req.body
    ? ` body=${JSON.stringify(req.body).substring(0, 200)}`
    : '';
  console.log(`→ ${method} ${originalUrl}${bodyPreview}`);

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? '🔴' : status >= 400 ? '🟡' : '🟢';
    console.log(`${color} ${method} ${originalUrl} → ${status} (${duration}ms)`);
  });

  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later' },
});

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/producer', producerRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/admin', adminRoutes);

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Bind to 0.0.0.0 so the server is reachable from Android emulator (10.0.2.2)
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Antártida API server running on 0.0.0.0:${PORT}`);
});

export default app;
