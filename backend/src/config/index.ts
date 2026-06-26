import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-me-refresh',
    // A retail cashier stands at the till for a full shift — a 15-minute access
    // token meant constant silent refreshes and, on any refresh hiccup, surprise
    // logouts. Default to a shift-length token; the 7-day refresh still rotates.
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  whatsapp: {
    apiUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  },

  sms: {
    provider: process.env.SMS_PROVIDER || 'none',
    apiKey: process.env.SMS_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || '',
  },

  app: {
    name: process.env.APP_NAME || 'ClothingERP',
    currency: process.env.DEFAULT_CURRENCY || 'INR',
    defaultTaxRate: parseFloat(process.env.DEFAULT_TAX_RATE || '18'),
  },
};
