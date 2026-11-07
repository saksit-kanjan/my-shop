import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProductRepository } from './domain/product.repository';
import { TypeOrmProductRepository } from './infrastructure/typeorm-product.repository';
import { BarcodeEntity, CategoryEntity, PremiumEntity, PriceHistory, ProductEntity, PromotionEntity } from './entities/products.entities';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({ imports: [AuthModule, TypeOrmModule.forFeature([CategoryEntity, ProductEntity, BarcodeEntity, PremiumEntity, PromotionEntity, PriceHistory])], controllers: [ProductsController], providers: [{ provide: ProductRepository, useClass: TypeOrmProductRepository }, ProductsService], exports: [ProductsService] })
export class ProductsModule {}
