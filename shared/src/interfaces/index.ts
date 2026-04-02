import {
  UserRole, PaymentMethod, PaymentStatus, SaleStatus, ReturnType, ReturnStatus,
  ReturnItemCondition, InventoryMovementType, StockTransferStatus, LoyaltyTier,
  LoyaltyTransactionType, AccountType, ExpenseStatus, CommissionStatus,
  PosSessionStatus, MessageType, MessageStatus,
} from '../enums';

// ─── Branch ──────────────────────────────────────────
export interface IBranch {
  id: number;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  email?: string;
  taxConfig: Record<string, any>;
  receiptHeader?: string;
  receiptFooter?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── User / Employee ─────────────────────────────────
export interface IUser {
  id: number;
  branchId: number;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: UserRole;
  commissionRate: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Brand ───────────────────────────────────────────
export interface IBrand {
  id: number;
  name: string;
  slug: string;
  logoUrl?: string;
  isActive: boolean;
  createdAt: Date;
}

// ─── Category ────────────────────────────────────────
export interface ICategory {
  id: number;
  name: string;
  slug: string;
  parentId?: number;
  isActive: boolean;
  createdAt: Date;
}

// ─── Product ─────────────────────────────────────────
export interface IProduct {
  id: number;
  brandId: number;
  categoryId: number;
  name: string;
  slug: string;
  description?: string;
  basePrice: number;
  costPrice: number;
  taxRate: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductVariant {
  id: number;
  productId: number;
  sku: string;
  size: string;
  color: string;
  barcode: string;
  priceOverride?: number;
  costOverride?: number;
  isActive: boolean;
  createdAt: Date;
}

// ─── Inventory ───────────────────────────────────────
export interface IInventory {
  id: number;
  variantId: number;
  branchId: number;
  quantity: number;
  minStockLevel: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInventoryMovement {
  id: number;
  variantId: number;
  branchId: number;
  type: InventoryMovementType;
  quantity: number;
  referenceId?: number;
  referenceType?: string;
  notes?: string;
  createdBy: number;
  createdAt: Date;
}

export interface IStockTransfer {
  id: number;
  fromBranchId: number;
  toBranchId: number;
  status: StockTransferStatus;
  createdBy: number;
  approvedBy?: number;
  createdAt: Date;
  completedAt?: Date;
}

// ─── Sale ────────────────────────────────────────────
export interface ISale {
  id: number;
  branchId: number;
  customerId?: number;
  userId: number;
  saleNumber: string;
  status: SaleStatus;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  loyaltyPointsEarned: number;
  loyaltyPointsRedeemed: number;
  notes?: string;
  createdAt: Date;
}

export interface ISaleItem {
  id: number;
  saleId: number;
  variantId: number;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxAmount: number;
  total: number;
  returnedQuantity: number;
}

// ─── Payment ─────────────────────────────────────────
export interface IPayment {
  id: number;
  saleId: number;
  method: PaymentMethod;
  amount: number;
  referenceNumber?: string;
  status: PaymentStatus;
  createdAt: Date;
}

// ─── Return ──────────────────────────────────────────
export interface IReturn {
  id: number;
  originalSaleId: number;
  branchId: number;
  userId: number;
  returnNumber: string;
  type: ReturnType;
  reason?: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  status: ReturnStatus;
  createdAt: Date;
}

export interface IReturnItem {
  id: number;
  returnId: number;
  saleItemId: number;
  variantId: number;
  quantity: number;
  unitPrice: number;
  condition: ReturnItemCondition;
}

// ─── POS Session ─────────────────────────────────────
export interface IPosSession {
  id: number;
  branchId: number;
  userId: number;
  openingAmount: number;
  closingAmount?: number;
  expectedAmount?: number;
  status: PosSessionStatus;
  openedAt: Date;
  closedAt?: Date;
  notes?: string;
}

// ─── Customer ────────────────────────────────────────
export interface ICustomer {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
  loyaltyPoints: number;
  loyaltyTier: LoyaltyTier;
  totalSpent: number;
  visitCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILoyaltyTransaction {
  id: number;
  customerId: number;
  saleId?: number;
  points: number;
  type: LoyaltyTransactionType;
  description?: string;
  createdAt: Date;
}

// ─── Accounting ──────────────────────────────────────
export interface IAccount {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  parentId?: number;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface IJournalEntry {
  id: number;
  branchId: number;
  entryNumber: string;
  date: Date;
  description: string;
  referenceType?: string;
  referenceId?: number;
  createdBy: number;
  createdAt: Date;
}

export interface IJournalLine {
  id: number;
  entryId: number;
  accountId: number;
  debit: number;
  credit: number;
  description?: string;
}

// ─── Expense ─────────────────────────────────────────
export interface IExpense {
  id: number;
  branchId: number;
  categoryId: number;
  amount: number;
  description: string;
  date: Date;
  paymentMethod: string;
  receiptUrl?: string;
  status: ExpenseStatus;
  createdBy: number;
  approvedBy?: number;
  createdAt: Date;
}

export interface IExpenseCategory {
  id: number;
  name: string;
  accountId?: number;
  isActive: boolean;
  createdAt: Date;
}

// ─── Employee ────────────────────────────────────────
export interface IAttendance {
  id: number;
  userId: number;
  branchId: number;
  clockIn: Date;
  clockOut?: Date;
  hoursWorked?: number;
  date: Date;
  createdAt: Date;
}

export interface ICommission {
  id: number;
  userId: number;
  saleId: number;
  amount: number;
  rate: number;
  status: CommissionStatus;
  payPeriodStart: Date;
  payPeriodEnd: Date;
  createdAt: Date;
}

// ─── Messaging ───────────────────────────────────────
export interface IMessageLog {
  id: number;
  customerId: number;
  type: MessageType;
  template: string;
  payload: Record<string, any>;
  status: MessageStatus;
  providerResponse?: Record<string, any>;
  createdAt: Date;
}

// ─── API Response ────────────────────────────────────
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Auth ────────────────────────────────────────────
export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ILoginRequest {
  email: string;
  password: string;
}

export interface IJwtPayload {
  userId: number;
  email: string;
  role: UserRole;
  branchId: number;
}
