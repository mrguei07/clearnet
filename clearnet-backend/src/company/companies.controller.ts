import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { CompanyRecord } from './company.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('companies')
@UseGuards(JwtAuthGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCompanyDto): Promise<CompanyRecord> {
    return this.companiesService.create(dto);
  }

  @Get()
  list(@Query('industry') industry?: string): Promise<CompanyRecord[]> {
    return this.companiesService.findAll(industry);
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<CompanyRecord> {
    const company = await this.companiesService.findById(id);
    if (!company) {
      throw new NotFoundException(`Entreprise ${id} introuvable`);
    }
    return company;
  }
}