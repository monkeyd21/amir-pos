import prisma from '../../config/database';
import { generateNumber } from '../../utils/helpers';

/**
 * Auto-create journal entries from a sale.
 * DR Cash/Bank (asset), CR Revenue, CR Tax Payable (liability)
 */
export async function createSaleJournalEntry(params: {
  saleId: number;
  branchId: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  paymentMethod: string;
  createdBy: number;
}) {
  const { saleId, branchId, subtotal, taxAmount, total, paymentMethod, createdBy } = params;

  // Find the appropriate accounts (by code convention)
  const cashAccount = await prisma.account.findFirst({
    where: {
      OR: [
        { code: '1010' }, // Cash
        { code: '1020' }, // Bank
        { name: { contains: paymentMethod === 'cash' ? 'Cash' : 'Bank', mode: 'insensitive' } },
      ],
      type: 'asset',
      isActive: true,
    },
  });

  const revenueAccount = await prisma.account.findFirst({
    where: {
      OR: [
        { code: '4010' }, // Sales Revenue
        { name: { contains: 'Revenue', mode: 'insensitive' } },
      ],
      type: 'revenue',
      isActive: true,
    },
  });

  const taxAccount = await prisma.account.findFirst({
    where: {
      OR: [
        { code: '2010' }, // Tax Payable
        { name: { contains: 'Tax', mode: 'insensitive' } },
      ],
      type: 'liability',
      isActive: true,
    },
  });

  // If accounts don't exist, skip auto journal creation
  if (!cashAccount || !revenueAccount) {
    console.warn('Auto journal skipped: required accounts not found (Cash/Revenue)');
    return null;
  }

  const entryNumber = generateNumber('JE');

  const lines: Array<{
    accountId: number;
    debit: number;
    credit: number;
    description?: string;
  }> = [
    {
      accountId: cashAccount.id,
      debit: total,
      credit: 0,
      description: `Payment received - Sale #${saleId}`,
    },
    {
      accountId: revenueAccount.id,
      debit: 0,
      credit: subtotal,
      description: `Sales revenue - Sale #${saleId}`,
    },
  ];

  if (taxAmount > 0 && taxAccount) {
    lines.push({
      accountId: taxAccount.id,
      debit: 0,
      credit: taxAmount,
      description: `Tax collected - Sale #${saleId}`,
    });
  } else if (taxAmount > 0 && !taxAccount) {
    // If no tax account, include tax in revenue
    lines[1].credit = total;
  }

  return prisma.journalEntry.create({
    data: {
      branchId,
      entryNumber,
      date: new Date(),
      description: `Auto-journal for Sale #${saleId}`,
      referenceType: 'sale',
      referenceId: saleId,
      createdBy,
      lines: {
        create: lines,
      },
    },
    include: {
      lines: {
        include: { account: { select: { id: true, code: true, name: true } } },
      },
    },
  });
}

/**
 * Auto-create journal entries from an approved expense.
 * DR Expense Account, CR Cash/Bank (asset)
 */
export async function createExpenseJournalEntry(params: {
  expenseId: number;
  branchId: number;
  amount: number;
  categoryId: number;
  paymentMethod: string;
  description: string;
  createdBy: number;
}) {
  const { expenseId, branchId, amount, categoryId, paymentMethod, description, createdBy } = params;

  // Find the expense account from the category
  const category = await prisma.expenseCategory.findUnique({
    where: { id: categoryId },
    include: { account: true },
  });

  let expenseAccountId: number | null = category?.accountId || null;

  if (!expenseAccountId) {
    // Fall back to a generic expense account
    const genericExpense = await prisma.account.findFirst({
      where: {
        OR: [
          { code: '5010' }, // General Expense
          { name: { contains: 'Expense', mode: 'insensitive' } },
        ],
        type: 'expense',
        isActive: true,
      },
    });
    expenseAccountId = genericExpense?.id || null;
  }

  // Find cash/bank account
  const cashAccount = await prisma.account.findFirst({
    where: {
      OR: [
        { code: '1010' },
        { code: '1020' },
        { name: { contains: paymentMethod === 'cash' ? 'Cash' : 'Bank', mode: 'insensitive' } },
      ],
      type: 'asset',
      isActive: true,
    },
  });

  if (!expenseAccountId || !cashAccount) {
    console.warn('Auto journal skipped: required accounts not found (Expense/Cash)');
    return null;
  }

  const entryNumber = generateNumber('JE');

  return prisma.journalEntry.create({
    data: {
      branchId,
      entryNumber,
      date: new Date(),
      description: `Auto-journal for Expense #${expenseId}: ${description}`,
      referenceType: 'expense',
      referenceId: expenseId,
      createdBy,
      lines: {
        create: [
          {
            accountId: expenseAccountId,
            debit: amount,
            credit: 0,
            description: `Expense: ${description}`,
          },
          {
            accountId: cashAccount.id,
            debit: 0,
            credit: amount,
            description: `Payment for expense #${expenseId}`,
          },
        ],
      },
    },
    include: {
      lines: {
        include: { account: { select: { id: true, code: true, name: true } } },
      },
    },
  });
}
