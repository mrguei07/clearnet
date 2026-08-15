import { Injectable, Inject } from '@nestjs/common';
import { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { CompanyRecord, Industry } from './company.entity';

export interface CreateCompanyInput {
  name: string;
  industry?: Industry;
  country?: string;
  address?: string;
}

export interface IndustryCount {
  industry: string | null;
  count: number;
}

@Injectable()
export class CompaniesService {
  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  private toCompany(node: unknown): CompanyRecord {
    const props = ((node as { properties?: Record<string, unknown> }).properties ??
      (node as Record<string, unknown>)) as {
      id?: string;
      name?: string;
      industry?: string;
      country?: string;
      address?: string;
      createdAt?: Date;
    };
    return {
      id: props.id ?? '',
      name: props.name ?? '',
      industry: (props.industry as Industry) ?? null,
      country: props.country ?? null,
      address: props.address ?? null,
      createdAt: this.toIso(props.createdAt),
    };
  }

  private toIso(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (value instanceof Date) return value.toISOString();
    const dt = value as { toStandardDate?: () => Date };
    if (typeof dt.toStandardDate === 'function') return dt.toStandardDate().toISOString();
    return new Date(String(value)).toISOString();
  }

  private toNumber(value: unknown): number {
    const int = value as { toNumber?: () => number } | null;
    if (int && typeof int.toNumber === 'function') return int.toNumber();
    return Number(value ?? 0);
  }

  async create(input: CreateCompanyInput): Promise<CompanyRecord> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `CREATE (c:Company {
           id: randomUUID(),
           name: $name,
           industry: $industry,
           country: $country,
           address: $address,
           createdAt: datetime()
         }) RETURN c`,
        {
          name: input.name,
          industry: input.industry ?? null,
          country: input.country ?? null,
          address: input.address ?? null,
        },
      );
      return this.toCompany(result.records[0].get('c'));
    } finally {
      await session.close();
    }
  }

  async findAll(industry?: string): Promise<CompanyRecord[]> {
    const session = this.driver.session();
    try {
      const filter = typeof industry === 'string' && industry.length > 0;
      const result = await session.run(
        `MATCH (c:Company)
         WHERE $filter = false OR c.industry = $industry
         RETURN c
         ORDER BY c.name ASC
         LIMIT 500`,
        { filter, industry: filter ? industry : null },
      );
      return result.records.map((record) => this.toCompany(record.get('c')));
    } finally {
      await session.close();
    }
  }

  async findById(id: string): Promise<CompanyRecord | null> {
    const session = this.driver.session();
    try {
      const result = await session.run('MATCH (c:Company {id: $id}) RETURN c', { id });
      if (result.records.length === 0) return null;
      return this.toCompany(result.records[0].get('c'));
    } finally {
      await session.close();
    }
  }

  async countByIndustry(): Promise<IndustryCount[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (c:Company) RETURN c.industry AS industry, count(c) AS count`,
      );
      return result.records.map((record) => ({
        industry: (record.get('industry') as string) ?? null,
        count: this.toNumber(record.get('count')),
      }));
    } finally {
      await session.close();
    }
  }
}