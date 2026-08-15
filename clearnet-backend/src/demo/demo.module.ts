import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { DemoController } from './demo.controller';

@Module({
  imports: [UsersModule, TransactionsModule],
  controllers: [DemoController],
})
export class DemoModule {}
