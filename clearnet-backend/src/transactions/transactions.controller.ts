import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { TransactionsService, TransactionRecord } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateTransactionDto,
  ): Promise<TransactionRecord> {
    return this.transactionsService.create({
      fromEmail: user.email,
      toEmail: dto.toEmail,
      amount: dto.amount,
      note: dto.note,
    });
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: TransactionRecord[]; total: number; page: number; limit: number }> {
    return this.transactionsService.list(user.email, Number(page) || 1, Number(limit) || 25);
  }

  @Get('balance')
  balance(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ balance: number; currency: 'CLRN'; lastTransaction: TransactionRecord | null }> {
    return this.transactionsService.balance(user.email);
  }

  @Get('history')
  history(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limit?: string,
  ): Promise<TransactionRecord[]> {
    return this.transactionsService.history(user.email, Number(limit) || 50);
  }
}
