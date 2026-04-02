export enum UserRole {
  OWNER = 'owner',
  MANAGER = 'manager',
  CASHIER = 'cashier',
  STAFF = 'staff',
}

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  UPI = 'upi',
}

export enum PaymentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  REFUNDED = 'refunded',
}

export enum SaleStatus {
  COMPLETED = 'completed',
  RETURNED = 'returned',
  PARTIALLY_RETURNED = 'partially_returned',
  VOID = 'void',
}

export enum ReturnType {
  RETURN = 'return',
  EXCHANGE = 'exchange',
}

export enum ReturnStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  COMPLETED = 'completed',
}

export enum ReturnItemCondition {
  RESELLABLE = 'resellable',
  DAMAGED = 'damaged',
}

export enum InventoryMovementType {
  PURCHASE = 'purchase',
  SALE = 'sale',
  RETURN = 'return',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  ADJUSTMENT = 'adjustment',
}

export enum StockTransferStatus {
  PENDING = 'pending',
  IN_TRANSIT = 'in_transit',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum LoyaltyTier {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
}

export enum LoyaltyTransactionType {
  EARNED = 'earned',
  REDEEMED = 'redeemed',
  ADJUSTED = 'adjusted',
  EXPIRED = 'expired',
}

export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

export enum ExpenseStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum CommissionStatus {
  PENDING = 'pending',
  PAID = 'paid',
}

export enum PosSessionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

export enum MessageType {
  WHATSAPP = 'whatsapp',
  SMS = 'sms',
}

export enum MessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
}
