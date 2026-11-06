import type { PricedCart } from '@my-shop/contracts';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class OpenShiftDto {
  @IsString() terminalId!: string;
  @IsInt() @Min(0) float!: number;
}

export class PaymentDto {
  @IsIn(['cash', 'promptpay', 'card', 'transfer']) method!: 'cash' | 'promptpay' | 'card' | 'transfer';
  @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsInt() tendered?: number;
  @IsOptional() @IsString() reference?: string;
}

export class ManualDiscountDto {
  @IsIn(['amount', 'percent']) type!: 'amount' | 'percent';
  @IsInt() @Min(1) value!: number;
  @IsString() reason!: string;
}

/** A bill to close. The server re-prices the lines, so `cart` only has to say WHAT was sold; the amounts are checked, not trusted. */
export class SaleDto {
  @IsObject() cart!: PricedCart;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentDto) payments!: PaymentDto[];
  @IsOptional() @IsInt() change?: number;
  @IsOptional() @IsString() memberPhone?: string;
  @IsOptional() @IsInt() @Min(0) pointsRedeemed?: number;
  @IsOptional() @IsString() exchangeFor?: string;
  @IsOptional() @ValidateNested() @Type(() => ManualDiscountDto) manualDiscount?: ManualDiscountDto;
  @IsOptional() @IsString() approverCode?: string;
}

export class CashMoveDto {
  @IsIn(['drop', 'out', 'in']) type!: 'drop' | 'out' | 'in';
  @IsInt() @Min(1) amount!: number;
  @IsString() reason!: string;
  @IsOptional() @IsString() approvedBy?: string;
}

export class CloseShiftDto {
  @IsInt() @Min(0) counted!: number;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() approverCode?: string;
}

export class DrawerOpenDto {
  @IsString() reason!: string;
  @IsOptional() @IsString() approverCode?: string;
}

export class ReturnLineDto {
  @IsString() productId!: string;
  @IsInt() @Min(1) qty!: number;
}

export class CreditNoteDto {
  @IsString() saleDocNo!: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReturnLineDto) lines?: ReturnLineDto[];
  @IsString() reason!: string;
  @IsOptional() @IsBoolean() restock?: boolean;
  @IsOptional() @IsString() approverCode?: string;
  @IsOptional() @IsBoolean() preview?: boolean;
}

export class TaxInvoiceDto {
  @IsString() buyerName!: string;
  @IsString() buyerAddress!: string;
  @IsString() buyerTaxId!: string;
  @IsOptional() @IsString() buyerBranch?: string;
}
