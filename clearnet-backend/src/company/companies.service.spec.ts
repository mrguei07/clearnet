import { Test, TestingModule } from '@nestjs/testing';
import { CompaniesService } from './companies.service';
import { Industry } from './company.entity';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';

interface MockSession {
  run: jest.Mock;
  close: jest.Mock;
}

function buildDriver(session: MockSession) {
  return { session: jest.fn().mockReturnValue(session) };
}

function node(properties: Record<string, unknown>) {
  return { properties };
}

describe('CompaniesService', () => {
  let service: CompaniesService;
  let session: MockSession;
  let driver: { session: jest.Mock };

  beforeEach(async () => {
    session = { run: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
    driver = buildDriver(session);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: NEO4J_DRIVER, useValue: driver },
      ],
    }).compile();
    service = module.get<CompaniesService>(CompaniesService);
  });

  it('crée une entreprise et mappe le nœud Neo4j', async () => {
    session.run.mockResolvedValue({
      records: [
        {
          get: (key: string) =>
            key === 'c'
              ? node({
                  id: 'c1',
                  name: 'MedSea Logistics',
                  industry: 'Maritime',
                  country: 'FR',
                  address: null,
                  createdAt: { toStandardDate: () => new Date('2026-01-01T00:00:00Z') },
                })
              : undefined,
        },
      ],
    });

    const company = await service.create({
      name: 'MedSea Logistics',
      industry: Industry.MARITIME,
      country: 'FR',
    });

    expect(company).toMatchObject({
      id: 'c1',
      name: 'MedSea Logistics',
      industry: 'Maritime',
      country: 'FR',
      address: null,
    });
    expect(company.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(session.run).toHaveBeenCalledWith(expect.stringContaining('CREATE (c:Company'), expect.any(Object));
    expect(session.close).toHaveBeenCalled();
  });

  it('applique le filtre secteur sur findAll uniquement si fourni', async () => {
    session.run.mockResolvedValue({ records: [] });
    await service.findAll('Biotech');
    const [, params] = session.run.mock.calls[0];
    expect(params.filter).toBe(true);
    expect(params.industry).toBe('Biotech');

    await service.findAll();
    const [, params2] = session.run.mock.calls[1];
    expect(params2.filter).toBe(false);
    expect(params2.industry).toBeNull();
  });

  it('convertis les comptages Integer en number', async () => {
    session.run.mockResolvedValue({
      records: [
        { get: (key: string) => (key === 'industry' ? 'Spatial' : { toNumber: () => 4 }) },
        { get: (key: string) => (key === 'industry' ? null : { toNumber: () => 1 }) },
      ],
    });
    const counts = await service.countByIndustry();
    expect(counts).toStrictEqual([
      { industry: 'Spatial', count: 4 },
      { industry: null, count: 1 },
    ]);
  });

  it('retourne null quand findById ne trouve rien', async () => {
    session.run.mockResolvedValue({ records: [] });
    await expect(service.findById('absent')).resolves.toBeNull();
  });
});