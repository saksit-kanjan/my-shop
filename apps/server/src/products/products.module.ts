import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BarcodeEntity, CategoryEntity, PremiumEntity, PriceHistory, ProductEntity, PromotionEntity } from './entities/products.entities';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({ imports: [AuthModule, TypeOrmModule.forFeature([CategoryEntity, ProductEntity, BarcodeEntity, PremiumEntity, PromotionEntity, PriceHistory])], controllers: [ProductsController], providers: [ProductsService], exports: [ProductsService] })
export class ProductsModule {}
