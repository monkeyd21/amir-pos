import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta, generateNumber } from '../../utils/helpers';
import { Decimal } from '@prisma/client/runtime/library';

export class AccountingService {
  // ─── Chart of Accounts ──────────────────────────────

  async getAccounts() {
    const accounts = await prisma.account.findMany({
      orderBy: { code: 'asc' },
      include: {
        children: {
          orderBy: { code: 'asc' },
          include: {
            children: {
              orderBy: { code: 'asc' },
            },
          },
        },
      },
    });

    // Return as tree (only root-level accounts)
    return accounts.filter((a) => a.parentId === null);
  }

  async createAccount(data: {
    code: string;
    name: string;
    type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
    parentId?: number | null;
    isSystem?: boolean;
  }) {
    const existing = await prisma.account.findUnique({ where: { code: data.code } });
    if (existing) {
      throw new AppError('Account code already exists', 409);
    }

    if (data.parentId) {
      const parent = await prisma.account.findUnique({ where: { id: data.parentId } });
      if (!parent) {
        throw new AppError('Parent account not found', 404);
      }
    }

    return prisma.account.create({ data });
  }

  async updateAccount(id: number, data: { name?: string; parentId?: number | null; isActive?: boolean }) {
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) {
      throw new AppError('Account not found', 404);
    }

    return prisma.account.update({ where: { id }, data });
  }

  // ─── Journal Entries ────────────────────────────────

  async listJournalEntries(query: {
    page?: string;
    limit?: string;
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { page, limit, skip } = getPagination(query);
    const where: any = {};

    if (query.branchId) where.branchId = parseInt(query.branchId);
    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) where.date.lte = new Date(query.endDate);
    }

    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          lines: {
            include: {
              account: { select: { id: true, code: true, name: true, type: true } },
            },
          },
          branch: { select: { id: true, name: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.journalEntry.count({ where }),
    ]);

    return { data: entries, meta: buildPaginationMeta(page, limit, total) };
  }

  async createJournalEntry(data: {
    branchId: number;
    date: string;
    description: string;
    referenceType?: string;
    referenceId?: number;
    lines: Array<{
      accountId: number;
      debit: number;
      credit: number;
      description?: string;
    }>;
    createdBy: number;
  }) {
    // Validate double-entry: total debits must equal total credits
    const totalDebits = data.lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredits = data.lines.reduce((sum, line) => sum + line.credit, 0);

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      throw new AppError(
        `Journal entry does not balance. Debits: ${totalDebits.toFixed(2)}, Credits: ${totalCredits.toFixed(2)}`,
        400
      );
    }

    // Validate each line has either debit or credit, not both
    for (const line of data.lines) {
      if (line.debit > 0 && line.credit > 0) {
        throw new AppError('A journal line cannot have both debit and credit', 400);
      }
      if (line.debit === 0 && line.credit === 0) {
        throw new AppError('A journal line must have either debit or credit', 400);
      }
    }

    // Validate all accounts exist
    const accountIds = [...new Set(data.lines.map((l) => l.accountId))];
    const accounts = await prisma.account.findMany({
      where: { id: { in: accountIds } },
    });
    if (accounts.length !== accountIds.length) {
      throw new AppError('One or more accounts not found', 404);
    }

    const entryNumber = generateNumber('JE');

    return prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          branchId: data.branchId,
          entryNumber,
          date: new Date(data.date),
          description: data.description,
          referenceType: data.referenceType,
          referenceId: data.referenceId,
          createdBy: data.createdBy,
          lines: {
            create: data.lines.map((line) => ({
              accountId: line.accountId,
              debit: line.debit,
              credit: line.credit,
              description: line.description,
            })),
          },
        },
        include: {
          lines: {
            include: {
              account: { select: { id: true, code: true, name: true, type: true } },
            },
          },
          branch: { select: { id: true, name: true } },
        },
      });

      return entry;
    });
  }

  // ─── General Ledger ─────────────────────────────────

  async getGeneralLedger(query: {
    startDate: string;
    endDate: string;
    branchId?: string;
    accountId?: string;
  }) {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    const accountWhere: any = { isActive: true };
    if (query.accountId) accountWhere.id = parseInt(query.accountId);

    const accounts = await prisma.account.findMany({
      where: accountWhere,
      orderBy: { code: 'asc' },
    });

    const entryWhere: any = {};
    if (query.branchId) entryWhere.branchId = parseInt(query.branchId);

    const ledger = await Promise.all(
      accounts.map(async (account) => {
        // Opening balance: sum of all transactions before startDate
        const openingLines = await prisma.journalLine.aggregate({
          where: {
            accountId: account.id,
            entry: {
              ...entryWhere,
              date: { lt: startDate },
            },
          },
          _sum: { debit: true, credit: true },
        });

        // Period transactions
        const periodLines = await prisma.journalLine.aggregate({
          where: {
            accountId: account.id,
            entry: {
              ...entryWhere,
              date: { gte: startDate, lte: endDate },
            },
          },
          _sum: { debit: true, credit: true },
        });

        const openingDebit = Number(openingLines._sum.debit || 0);
        const openingCredit = Number(openingLines._sum.credit || 0);
        const periodDebit = Number(periodLines._sum.debit || 0);
        const periodCredit = Number(periodLines._sum.credit || 0);

        // For asset/expense: debit-normal; balance = debits - credits
        // For liability/equity/revenue: credit-normal; balance = credits - debits
        const isDebitNormal = ['asset', 'expense'].includes(account.type);
        const openingBalance = isDebitNormal
          ? openingDebit - openingCredit
          : openingCredit - openingDebit;
        const closingBalance = isDebitNormal
          ? openingBalance + periodDebit - periodCredit
          : openingBalance + periodCredit - periodDebit;

        return {
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.type,
          openingBalance,
          totalDebits: periodDebit,
          totalCredits: periodCredit,
          closingBalance,
        };
      })
    );

    // Filter out accounts with no activity
    const activeLedger = ledger.filter(
      (l) =>
        l.openingBalance !== 0 ||
        l.totalDebits !== 0 ||
        l.totalCredits !== 0
    );

    return activeLedger;
  }

  // ─── Profit & Loss ──────────────────────────────────

  async getProfitAndLoss(query: {
    startDate: string;
    endDate: string;
    branchId?: string;
  }) {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    const entryWhere: any = {
      date: { gte: startDate, lte: endDate },
    };
    if (query.branchId) entryWhere.branchId = parseInt(query.branchId);

    // Get all revenue accounts with their totals
    const revenueAccounts = await prisma.account.findMany({
      where: { type: 'revenue', isActive: true },
      orderBy: { code: 'asc' },
    });

    const expenseAccounts = await prisma.account.findMany({
      where: { type: 'expense', isActive: true },
      orderBy: { code: 'asc' },
    });

    const getAccountTotals = async (accountIds: number[]) => {
      if (accountIds.length === 0) return [];

      return Promise.all(
        accountIds.map(async (accountId) => {
          const result = await prisma.journalLine.aggregate({
            where: {
              accountId,
              entry: entryWhere,
            },
            _sum: { debit: true, credit: true },
          });

          return {
            accountId,
            totalDebit: Number(result._sum.debit || 0),
            totalCredit: Number(result._sum.credit || 0),
          };
        })
      );
    };

    const revenueTotals = await getAccountTotals(revenueAccounts.map((a) => a.id));
    const expenseTotals = await getAccountTotals(expenseAccounts.map((a) => a.id));

    const revenueItems = revenueAccounts.map((account, i) => {
      const totals = revenueTotals[i];
      // Revenue is credit-normal
      const amount = totals.totalCredit - totals.totalDebit;
      return {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        amount,
      };
    });

    const expenseItems = expenseAccounts.map((account, i) => {
      const totals = expenseTotals[i];
      // Expense is debit-normal
      const amount = totals.totalDebit - totals.totalCredit;
      return {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        amount,
      };
    });

    const totalRevenue = revenueItems.reduce((sum, r) => sum + r.amount, 0);
    const totalExpenses = expenseItems.reduce((sum, e) => sum + e.amount, 0);
    const netIncome = totalRevenue - totalExpenses;

    return {
      period: { startDate: query.startDate, endDate: query.endDate },
      revenue: {
        items: revenueItems.filter((r) => r.amount !== 0),
        total: totalRevenue,
      },
      expenses: {
        items: expenseItems.filter((e) => e.amount !== 0),
        total: totalExpenses,
      },
      netIncome,
    };
  }

  // ─── Trial Balance ──────────────────────────────────

  async getTrialBalance(query: { asOfDate: string; branchId?: string }) {
    const asOfDate = new Date(query.asOfDate);

    const entryWhere: any = {
      date: { lte: asOfDate },
    };
    if (query.branchId) entryWhere.branchId = parseInt(query.branchId);

    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    const trialBalance = await Promise.all(
      accounts.map(async (account) => {
        const result = await prisma.journalLine.aggregate({
          where: {
            accountId: account.id,
            entry: entryWhere,
          },
          _sum: { debit: true, credit: true },
        });

        const totalDebit = Number(result._sum.debit || 0);
        const totalCredit = Number(result._sum.credit || 0);

        const isDebitNormal = ['asset', 'expense'].includes(account.type);
        const balance = isDebitNormal
          ? totalDebit - totalCredit
          : totalCredit - totalDebit;

        return {
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.type,
          debit: balance > 0 && isDebitNormal ? balance : balance < 0 && !isDebitNormal ? Math.abs(balance) : balance > 0 ? 0 : 0,
          credit: balance > 0 && !isDebitNormal ? balance : balance < 0 && isDebitNormal ? Math.abs(balance) : balance > 0 ? 0 : 0,
        };
      })
    );

    // Simplify: show debit balances in debit column, credit balances in credit column
    const simplifiedBalance = trialBalance.map((tb) => {
      const totalDebit = Number(tb.debit);
      const totalCredit = Number(tb.credit);
      const isDebitNormal = ['asset', 'expense'].includes(tb.accountType);

      // Recalculate
      const rawDebit = totalDebit;
      const rawCredit = totalCredit;

      return tb;
    });

    // Recompute properly
    const result = await Promise.all(
      accounts.map(async (account) => {
        const agg = await prisma.journalLine.aggregate({
          where: {
            accountId: account.id,
            entry: entryWhere,
          },
          _sum: { debit: true, credit: true },
        });

        const totalDebit = Number(agg._sum.debit || 0);
        const totalCredit = Number(agg._sum.credit || 0);
        const netDebit = totalDebit - totalCredit;

        return {
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.type,
          debit: netDebit > 0 ? netDebit : 0,
          credit: netDebit < 0 ? Math.abs(netDebit) : 0,
        };
      })
    );

    const activeAccounts = result.filter((r) => r.debit !== 0 || r.credit !== 0);

    const totalDebits = activeAccounts.reduce((sum, a) => sum + a.debit, 0);
    const totalCredits = activeAccounts.reduce((sum, a) => sum + a.credit, 0);

    return {
      asOfDate: query.asOfDate,
      accounts: activeAccounts,
      totalDebits,
      totalCredits,
      isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
    };
  }
}

export const accountingService = new AccountingService();
