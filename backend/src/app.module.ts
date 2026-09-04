import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { InventoryModule } from './inventory/inventory.module';
import { CustomersModule } from './customers/customers.module';
import { SalesModule } from './sales/sales.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { CashModule } from './cash/cash.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { StoreSettingsModule } from './store-settings/store-settings.module';
import { LicenseModule } from './license/license.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    InventoryModule,
    CustomersModule,
    SalesModule,
    FiscalModule,
    CashModule,
    DashboardModule,
    StoreSettingsModule,
    LicenseModule,
    HealthModule,
  ],
})
export class AppModule {}
