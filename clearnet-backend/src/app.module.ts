import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Neo4jModule } from './neo4j/neo4j.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { DemoModule } from './demo/demo.module';
import { CompanyModule } from './company/company.module';
import { ComplianceModule } from './compliance/compliance.module';
import { ZkProofModule } from './zkproof/zkproof.module';
import { OracleModule } from './oracles/oracle.module';
import { GraphModule } from './graph/graph.module';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { AdminModule } from './admin/admin.module';
import { MetricsModule } from './metrics/metrics.module';
import { BillingModule } from './billing/billing.module';
import { SignaturesModule } from './signatures/signatures.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('THROTTLE_TTL', 60000),
            limit: config.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
      }),
    }),
    Neo4jModule.forRoot(),
    AuthModule,
    UsersModule,
    TransactionsModule,
    AdminModule,
    BillingModule,
    SignaturesModule,
    BlockchainModule,
    MetricsModule,
    DemoModule,
    CompanyModule,
    ComplianceModule,
    ZkProofModule,
    OracleModule,
    GraphModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
