import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { IndustriesController } from './industries.controller';

@Module({
  controllers: [CompaniesController, IndustriesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompanyModule {}