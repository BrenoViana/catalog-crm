import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { AccessModule } from './access/access.module';
import { AppSettingsModule } from './settings/app-settings.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { PromotionsModule } from './promotions/promotions.module';
import { InventoryModule } from './inventory/inventory.module';
import { CustomersModule } from './customers/customers.module';
import { SalesModule } from './sales/sales.module';
import { PaymentsModule } from './payments/payments.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { CashModule } from './cash/cash.module';
import { FinanceModule } from './finance/finance.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { StoreSettingsModule } from './store-settings/store-settings.module';
import { LicenseModule } from './license/license.module';
import { HealthModule } from './health/health.module';
import { OpsModule } from './ops/ops.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    AccessModule,
    AppSettingsModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    PromotionsModule,
    InventoryModule,
    CustomersModule,
    SalesModule,
    PaymentsModule,
    FiscalModule,
    CashModule,
    FinanceModule,
    LoyaltyModule,
    DashboardModule,
    ReportsModule,
    StoreSettingsModule,
    LicenseModule,
    HealthModule,
    OpsModule,
  ],
})
export class AppModule {}
