import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';

// Import routes
import authRoutes from './modules/auth/routes';
import branchRoutes from './modules/branches/routes';
import userRoutes from './modules/users/routes';
import brandRoutes from './modules/brands/routes';
import categoryRoutes from './modules/categories/routes';
import colorRoutes from './modules/colors/routes';
import productRoutes from './modules/products/routes';
import inventoryRoutes from './modules/inventory/routes';
import barcodeRoutes from './modules/barcodes/routes';
import posRoutes from './modules/pos/routes';
import salesRoutes from './modules/sales/routes';
import customerRoutes from './modules/customers/routes';
import loyaltyRoutes from './modules/loyalty/routes';
import paymentRoutes from './modules/payments/routes';
import expenseRoutes from './modules/expenses/routes';
import accountingRoutes from './modules/accounting/routes';
import reportRoutes from './modules/reports/routes';
import employeeRoutes from './modules/employees/routes';
import messagingRoutes from './modules/messaging/routes';
import settingsRoutes from './modules/settings/routes';
import offersRoutes from './modules/offers/routes';
import printingRoutes from './modules/printing/routes';
import vendorRoutes from './modules/vendors/routes';
import { posController } from './modules/pos/controller';

const app = express();

// Payment webhook (needs raw body for signature verification) — must be before JSON parser
app.post('/api/v1/webhooks/payment', express.raw({ type: 'application/json' }), posController.handlePaymentWebhook);

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: config.nodeEnv === 'production' ? true : config.frontendUrl,
  credentials: true,
}));
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/branches', branchRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/brands', brandRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/colors', colorRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/barcodes', barcodeRoutes);
app.use('/api/v1/pos', posRoutes);
app.use('/api/v1/sales', salesRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/loyalty', loyaltyRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/accounting', accountingRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/employees', employeeRoutes);
app.use('/api/v1/messaging', messagingRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/offers', offersRoutes);
app.use('/api/v1/printing', printingRoutes);
app.use('/api/v1/vendors', vendorRoutes);

// Serve Angular frontend in production
if (config.nodeEnv === 'production') {
  const publicPath = path.join(__dirname, '..', 'public');
  app.use(express.static(publicPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
} else {
  app.use(notFoundHandler);
}

// Error handling
app.use(errorHandler);

export default app;
