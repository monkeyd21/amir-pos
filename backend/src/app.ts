import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';

// Import routes
import authRoutes from './modules/auth/routes';
import branchRoutes from './modules/branches/routes';
import userRoutes from './modules/users/routes';
import brandRoutes from './modules/brands/routes';
import categoryRoutes from './modules/categories/routes';
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

const app = express();

// Middleware
app.use(helmet());
app.use(cors({ origin: config.frontendUrl, credentials: true }));
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

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
