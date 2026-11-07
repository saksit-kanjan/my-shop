import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('categories')
export class CategoryEntity {
  @PrimaryColumn('text') id!: string;
  @Column('text') name!: string;
  @Column('int', { default: 0 }) sort!: number;
}

@Entity('products')
export class ProductEntity {
  @PrimaryColumn('text') id!: string;
  @Column('text', { unique: true }) sku!: string;
  @Column('text') name!: string;
  @Column('text') categoryId!: string;
  @Column('int') price!: number;
  @Column('int') memberPrice!: number;
  @Column('text', { nullable: true }) imageKey!: string | null;
  @Column('boolean', { default: true }) active!: boolean;
  @Column('int', { default: 0 }) sort!: number;
  @Column('int', { default: 0 }) cost!: number;
  @Column('int', { default: 0 }) reorderPoint!: number;
}

@Entity('barcodes')
export class BarcodeEntity {
  @PrimaryColumn('text') code!: string;
  @Column('text') productId!: string;
}

@Entity('premiums')
export class PremiumEntity {
  @PrimaryColumn('text') id!: string;
  @Column('text') name!: string;
}

@Entity('promotions')
export class PromotionEntity {
  @PrimaryColumn('text') id!: string;
  @Column('text') kind!: string;
  @Column('jsonb') body!: object;
  @Column('boolean', { default: true }) active!: boolean;
  @Column('int', { default: 0 }) sort!: number;
}

@Entity('price_history')
export class PriceHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text') productId!: string;
  @Column('int') price!: number;
  @Column('int') memberPrice!: number;
  @Column('int') cost!: number;
  @Column('timestamptz') at!: Date;
  @Column('text', { nullable: true }) by!: string | null;
}
