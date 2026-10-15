import app from './app';
import { config } from './config';
import prisma from './config/database';
import { startReservationSweeper, stopReservationSweeper } from './modules/shop/sweeper';
import { startLoyaltyExpirySweeper, stopLoyaltyExpirySweeper } from './modules/loyalty/expiry';

const start = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('Database connected successfully');

    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
    });

    // Tidies lapsed storefront stock holds. Purely cosmetic — availability
    // already ignores expired holds — so a failure here is never fatal.
    startReservationSweeper();
    // Writes off loyalty points past their expiry (only if the shop set one).
    startLoyaltyExpirySweeper();
  } catch (error) {
    console.error('Failed to start server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  stopReservationSweeper();
  stopLoyaltyExpirySweeper();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  stopReservationSweeper();
  stopLoyaltyExpirySweeper();
  await prisma.$disconnect();
  process.exit(0);
});

start();

