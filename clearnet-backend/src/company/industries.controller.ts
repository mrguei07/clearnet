import { Controller, Get, NotFoundException, Param, ParseEnumPipe } from '@nestjs/common';
import {
  Industry,
  IndustryDetails,
  findIndustryDetails,
  getIndustries,
} from './company.entity';
import { CompaniesService } from './companies.service';

export interface IndustryStatus extends IndustryDetails {
  companies: number;
}

@Controller('industries')
export class IndustriesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  async list(): Promise<IndustryStatus[]> {
    const details = getIndustries();
    const counts = new Map(
      (await this.companiesService.countByIndustry()).map((entry) => [
        entry.industry,
        entry.count,
      ]),
    );
    return details.map((entry) => ({
      ...entry,
      companies: counts.get(entry.industry) ?? 0,
    }));
  }

  @Get('stats')
  async stats(): Promise<{
    total: number;
    legacy: number;
    extension: number;
    industries: IndustryStatus[];
  }> {
    const all = await this.list();
    return {
      total: all.length,
      legacy: all.filter((entry) => entry.version === 'v1').length,
      extension: all.filter((entry) => entry.version === 'v1.1').length,
      industries: all,
    };
  }

  @Get(':code')
  async getByCode(@Param('code', new ParseEnumPipe(Industry)) code: Industry): Promise<IndustryStatus> {
    const details = findIndustryDetails(code);
    if (!details) {
      throw new NotFoundException(`Secteur ${code} inconnu`);
    }
    const counts = await this.companiesService.countByIndustry();
    const count = counts.find((entry) => entry.industry === code)?.count ?? 0;
    return { ...details, companies: count };
  }
}