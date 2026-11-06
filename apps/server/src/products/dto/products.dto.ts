import type { Promotion } from '@my-shop/contracts';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class ProductDto {
  @IsString() sku!: string;
  @IsString() name!: string;
  @IsString() categoryId!: string;
  @IsInt() @Min(0) price!: number;
  @IsInt() @Min(0) memberPrice!: number;
  @IsOptional() @IsInt() @Min(0) cost?: number;
  @IsOptional() @IsInt() @Min(0) reorderPoint?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) barcodes?: string[];
  @IsOptional() @IsString() imageKey?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class NameDto {
  @IsString() name!: string;
}

export class PromotionDto {
  /** The shape depends on `kind`; the service checks the numbers and that the products exist. */
  @IsObject() promotion!: Promotion;
  @IsOptional() @IsBoolean() active?: boolean;
}
