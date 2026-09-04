import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { checkDatabaseHealth } from './config/database.js';
import authRouter from './routes/auth.routes.js';
import seekerRouter from './routes/seeker.routes.js';

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: [
    env.FRONTEND_URL,
    env.FRONTEND_URL_PROD,
    'http://localhost:5173', // Vite default
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

app.use(limiter);

// Health check route - basic application health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database health check route
app.get('/api/health/db', async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    
    if (dbHealth.success) {
      res.json(dbHealth);
    } else {
      res.status(503).json(dbHealth);
    }
  } catch (error) {
    console.error('Error checking database health:', error);
    res.status(503).json({
      success: false,
      database: 'disconnected',
      error: 'Unable to check database health',
    });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/seeker', seekerRouter);

// API v1 routes (will be added as features are implemented)
app.use('/api/v1', (req, res) => {
  res.status(404).json({ message: 'API endpoint not implemented yet' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: 'Not Found',
    path: req.originalUrl,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    message,
    status,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});


export default app;
