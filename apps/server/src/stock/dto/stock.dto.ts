import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class AdjustStockDto {
  @IsString() productId!: string;
  @IsInt() qty!: number;
  @IsIn(['waste', 'lost', 'expired', 'other']) reason!: 'waste' | 'lost' | 'expired' | 'other';
  @IsOptional() @IsString() note?: string;
}

export class PremiumStockDto {
  @IsInt() qty!: number;
}

export class SupplierDto {
  @IsString() name!: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() terms?: string;
}

export class ReceiptLineDto {
  @IsString() productId!: string;
  @IsInt() @Min(1) qty!: number;
  @IsInt() @Min(0) unitCost!: number;
}

export class ReceiptDto {
  @IsString() supplierId!: string;
  @IsOptional() @IsString() ref?: string;
  @IsOptional() @IsString() note?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiptLineDto) lines!: ReceiptLineDto[];
}

export class StartCountDto {
  @IsOptional() @IsString() categoryId?: string;
}

export class CountedLineDto {
  @IsString() productId!: string;
  @IsInt() @Min(0) qty!: number;
}

export class CountedDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CountedLineDto) lines!: CountedLineDto[];
}
