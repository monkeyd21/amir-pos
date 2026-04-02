import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create default branch
  const branch = await prisma.branch.create({
    data: {
      name: 'Main Store',
      code: 'MAIN',
      address: '123 Main Street',
      phone: '+91-9876543210',
      email: 'main@clothingerp.com',
      taxConfig: { gst: 18 },
      receiptHeader: 'Welcome to Our Store!',
      receiptFooter: 'Thank you for shopping with us!',
    },
  });

  // Create second branch
  const branch2 = await prisma.branch.create({
    data: {
      name: 'Mall Outlet',
      code: 'MALL',
      address: '456 Mall Road',
      phone: '+91-9876543211',
      email: 'mall@clothingerp.com',
      taxConfig: { gst: 18 },
      receiptHeader: 'Welcome to Mall Outlet!',
      receiptFooter: 'Thank you for shopping with us!',
    },
  });

  // Create owner user
  const passwordHash = await bcrypt.hash('admin123', 12);
  const owner = await prisma.user.create({
    data: {
      branchId: branch.id,
      email: 'admin@clothingerp.com',
      passwordHash,
      firstName: 'Admin',
      lastName: 'Owner',
      phone: '+91-9876543210',
      role: 'owner',
      commissionRate: 0,
    },
  });

  // Create manager
  await prisma.user.create({
    data: {
      branchId: branch.id,
      email: 'manager@clothingerp.com',
      passwordHash: await bcrypt.hash('manager123', 12),
      firstName: 'Store',
      lastName: 'Manager',
      phone: '+91-9876543212',
      role: 'manager',
      commissionRate: 2,
    },
  });

  // Create cashier
  await prisma.user.create({
    data: {
      branchId: branch.id,
      email: 'cashier@clothingerp.com',
      passwordHash: await bcrypt.hash('cashier123', 12),
      firstName: 'John',
      lastName: 'Cashier',
      phone: '+91-9876543213',
      role: 'cashier',
      commissionRate: 1,
    },
  });

  // Create brands
  const brand1 = await prisma.brand.create({ data: { name: 'Levis', slug: 'levis' } });
  const brand2 = await prisma.brand.create({ data: { name: 'Nike', slug: 'nike' } });
  const brand3 = await prisma.brand.create({ data: { name: 'Zara', slug: 'zara' } });

  // Create categories
  const mensCat = await prisma.category.create({ data: { name: 'Men', slug: 'men' } });
  const womensCat = await prisma.category.create({ data: { name: 'Women', slug: 'women' } });
  const shirtsCat = await prisma.category.create({ data: { name: 'Shirts', slug: 'shirts', parentId: mensCat.id } });
  const jeansCat = await prisma.category.create({ data: { name: 'Jeans', slug: 'jeans', parentId: mensCat.id } });
  const dressesCat = await prisma.category.create({ data: { name: 'Dresses', slug: 'dresses', parentId: womensCat.id } });

  // Create products with variants
  const product1 = await prisma.product.create({
    data: {
      brandId: brand1.id,
      categoryId: jeansCat.id,
      name: 'Levis 501 Original Jeans',
      slug: 'levis-501-original-jeans',
      description: 'Classic straight fit jeans',
      basePrice: 3999,
      costPrice: 2200,
      taxRate: 18,
    },
  });

  // Sizes and colors for jeans
  const sizes = ['28', '30', '32', '34', '36'];
  const colors = ['Blue', 'Black', 'Dark Blue'];

  let barcodeCounter = 2000000000001;
  for (const size of sizes) {
    for (const color of colors) {
      const variant = await prisma.productVariant.create({
        data: {
          productId: product1.id,
          sku: `LEV-501-${size}-${color.substring(0, 3).toUpperCase()}-${barcodeCounter.toString().slice(-4)}`,
          size,
          color,
          barcode: barcodeCounter.toString(),
        },
      });

      // Add inventory for both branches
      await prisma.inventory.create({
        data: { variantId: variant.id, branchId: branch.id, quantity: 10, minStockLevel: 3 },
      });
      await prisma.inventory.create({
        data: { variantId: variant.id, branchId: branch2.id, quantity: 5, minStockLevel: 2 },
      });

      barcodeCounter++;
    }
  }

  const product2 = await prisma.product.create({
    data: {
      brandId: brand2.id,
      categoryId: shirtsCat.id,
      name: 'Nike Dri-FIT Polo',
      slug: 'nike-dri-fit-polo',
      description: 'Performance polo shirt',
      basePrice: 2499,
      costPrice: 1400,
      taxRate: 18,
    },
  });

  const shirtSizes = ['S', 'M', 'L', 'XL', 'XXL'];
  const shirtColors = ['White', 'Navy', 'Red'];

  for (const size of shirtSizes) {
    for (const color of shirtColors) {
      const variant = await prisma.productVariant.create({
        data: {
          productId: product2.id,
          sku: `NIK-DRI-${size}-${color.substring(0, 3).toUpperCase()}-${barcodeCounter.toString().slice(-4)}`,
          size,
          color,
          barcode: barcodeCounter.toString(),
        },
      });
      await prisma.inventory.create({
        data: { variantId: variant.id, branchId: branch.id, quantity: 15, minStockLevel: 5 },
      });
      await prisma.inventory.create({
        data: { variantId: variant.id, branchId: branch2.id, quantity: 8, minStockLevel: 3 },
      });
      barcodeCounter++;
    }
  }

  // Create sample customers
  await prisma.customer.create({
    data: {
      firstName: 'Rahul',
      lastName: 'Sharma',
      phone: '+91-9998887770',
      email: 'rahul@example.com',
      loyaltyPoints: 150,
      loyaltyTier: 'silver',
      totalSpent: 15000,
      visitCount: 8,
    },
  });

  await prisma.customer.create({
    data: {
      firstName: 'Priya',
      lastName: 'Patel',
      phone: '+91-9998887771',
      email: 'priya@example.com',
      loyaltyPoints: 50,
      loyaltyTier: 'bronze',
      totalSpent: 5000,
      visitCount: 3,
    },
  });

  // Create loyalty config
  await prisma.loyaltyConfig.create({
    data: {
      pointsPerAmount: 1,
      amountPerPoint: 100,
      redemptionValue: 1,
      tierThresholds: { silver: 10000, gold: 50000, platinum: 200000 },
      earningMultipliers: { bronze: 1, silver: 1.5, gold: 2, platinum: 3 },
    },
  });

  // Create chart of accounts
  const accounts = [
    { code: '1000', name: 'Cash', type: 'asset' as const, isSystem: true },
    { code: '1010', name: 'Bank Account', type: 'asset' as const, isSystem: true },
    { code: '1020', name: 'Accounts Receivable', type: 'asset' as const, isSystem: true },
    { code: '1100', name: 'Inventory', type: 'asset' as const, isSystem: true },
    { code: '2000', name: 'Accounts Payable', type: 'liability' as const, isSystem: true },
    { code: '2010', name: 'Tax Payable (GST)', type: 'liability' as const, isSystem: true },
    { code: '3000', name: 'Owner Equity', type: 'equity' as const, isSystem: true },
    { code: '3010', name: 'Retained Earnings', type: 'equity' as const, isSystem: true },
    { code: '4000', name: 'Sales Revenue', type: 'revenue' as const, isSystem: true },
    { code: '4010', name: 'Sales Returns', type: 'revenue' as const, isSystem: true },
    { code: '5000', name: 'Cost of Goods Sold', type: 'expense' as const, isSystem: true },
    { code: '5100', name: 'Rent Expense', type: 'expense' as const, isSystem: false },
    { code: '5200', name: 'Salary Expense', type: 'expense' as const, isSystem: false },
    { code: '5300', name: 'Utilities Expense', type: 'expense' as const, isSystem: false },
    { code: '5400', name: 'Marketing Expense', type: 'expense' as const, isSystem: false },
    { code: '5500', name: 'Office Supplies', type: 'expense' as const, isSystem: false },
    { code: '5600', name: 'Miscellaneous Expense', type: 'expense' as const, isSystem: false },
  ];

  for (const acc of accounts) {
    await prisma.account.create({ data: acc });
  }

  // Create expense categories
  await prisma.expenseCategory.create({ data: { name: 'Rent' } });
  await prisma.expenseCategory.create({ data: { name: 'Salaries' } });
  await prisma.expenseCategory.create({ data: { name: 'Utilities' } });
  await prisma.expenseCategory.create({ data: { name: 'Marketing' } });
  await prisma.expenseCategory.create({ data: { name: 'Office Supplies' } });
  await prisma.expenseCategory.create({ data: { name: 'Miscellaneous' } });

  console.log('Seed completed successfully!');
  console.log('Default login: admin@clothingerp.com / admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
