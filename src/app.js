import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { checkDatabaseHealth } from './config/database.js';
import adminRouter from './routes/admin.routes.js';
import authRouter from './routes/auth.routes.js';
import employerRouter from './routes/employer.routes.js';
import publicJobsRouter from './routes/publicJobs.routes.js';
import publicRouter from './routes/public.routes.js';
import seekerRouter from './routes/seeker.routes.js';
import { flutterwaveWebhook } from './controllers/contract.controller.js';
import { paystackWithdrawalWebhook } from './controllers/withdrawal.controller.js';
import { readSiteContent } from './controllers/siteContent.controller.js';

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: [
    env.FRONTEND_URL,
    env.FRONTEND_URL_PROD,
    ...(env.NODE_ENV === 'development' || env.NODE_ENV === 'test' ? ['http://localhost:5173'] : []),
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

app.post('/api/payments/paystack/withdrawal-webhook', express.raw({ type: 'application/json', limit: '1mb' }), paystackWithdrawalWebhook);

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

app.use('/api/admin', adminRouter);
app.get('/api/content', readSiteContent);
app.use('/api/auth', authRouter);
app.use('/api/employer', employerRouter);
app.use('/api/jobs', publicJobsRouter);
app.use('/api/public', publicRouter);
app.use('/api/seeker', seekerRouter);
app.post('/api/payments/flutterwave/webhook', flutterwaveWebhook);

// API v1 routes (will be added as features are implemented)
app.use('/api/v1', (req, res) => {
  res.status(404).json({ message: "We couldn't find what you're looking for.", status: 404 });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "We couldn't find what you're looking for.", status: 404 });
});

const technicalErrorPattern = /(prisma|sql|database|stack|internal server|econn|enotfound|socket|syntaxerror|typeerror|referenceerror| at \w+\s*\()/i;

const safeErrorMessage = (error, status) => {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403 && ['ROLE_MISMATCH', 'EMPLOYER_NOT_VERIFIED'].includes(error?.publicCode)) {
    const message = String(error?.publicMessage ?? error?.message ?? '').trim();
    if (message && !technicalErrorPattern.test(message)) return message;
  }
  if (status === 403) return "You don't have permission to perform this action.";
  if (status === 408) return 'The request took too long to complete. Please try again.';

  const message = String(error?.publicMessage ?? error?.message ?? '').trim();
  if (error?.publicMessage) return message;
  if (technicalErrorPattern.test(message)) return status >= 500 ? 'Something went wrong on our side. Please try again shortly.' : 'Something went wrong. Please try again.';
  if (status === 404 && message) return message;
  if (status === 404) return "We couldn't find what you're looking for.";
  if (status >= 500) return 'Something went wrong on our side. Please try again shortly.';
  return message || 'Something went wrong. Please try again.';
};

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);

  const status = err.status || err.statusCode || 500;
  const message = safeErrorMessage(err, status);

  res.status(status).json({
    ...(err.publicCode
      ? { success: false, error: { code: err.publicCode, message } }
      : { message, status }),
  });
});


export default app;
