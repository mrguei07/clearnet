import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { UsersService } from '../users/users.service';
import { TransactionsService } from '../transactions/transactions.service';
import { DemoApiKeyGuard } from '../common/guards/demo-api-key.guard';

const DEMO_USERS = [
  { email: 'alice@clearnet.io', name: 'Alice' },
  { email: 'bob@clearnet.io', name: 'Bob' },
  { email: 'carol@clearnet.io', name: 'Carol' },
];

const DEMO_PASSWORD = 'clearnet-demo';

const DEMO_TRANSACTIONS = [
  { from: 'alice@clearnet.io', to: 'bob@clearnet.io', amount: 250, note: 'Facture fournisseur' },
  { from: 'bob@clearnet.io', to: 'carol@clearnet.io', amount: 120, note: 'Prestation sous-traitée' },
  { from: 'carol@clearnet.io', to: 'alice@clearnet.io', amount: 80, note: 'Compensation partielle' },
];

/**
 * API de démo partenaire (protégée par X-Demo-Key).
 * seed : crée les comptes démo et un jeu de transactions initial.
 * status : compteurs pour le tableau de bord de démonstration.
 */
@Controller('demo')
@UseGuards(DemoApiKeyGuard)
export class DemoController {
  constructor(
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
    private readonly usersService: UsersService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Body() body: { industry?: string } = {},
  ): Promise<{ seeded: boolean; users: string[]; password: string }> {
    const industry = body.industry ?? null;
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const created: string[] = [];

    for (const demo of DEMO_USERS) {
      const existing = await this.usersService.findByEmail(demo.email);
      if (!existing) {
        await this.usersService.create({ email: demo.email, name: demo.name, passwordHash, industry });
        created.push(demo.email);
      }
    }

    const alice = await this.usersService.findByEmail('alice@clearnet.io');
    if (alice) {
      const history = await this.transactionsService.history(alice.email, 1);
      if (history.length === 0) {
        for (const t of DEMO_TRANSACTIONS) {
          await this.transactionsService.create({
            fromEmail: t.from,
            toEmail: t.to,
            amount: t.amount,
            note: t.note,
          });
        }
      }
    }

    return {
      seeded: created.length > 0,
      users: DEMO_USERS.map((u) => u.email),
      password: DEMO_PASSWORD,
    };
  }

  @Get('status')
  async status(): Promise<{ users: number; transactions: number }> {
    const session = this.driver.session();
    try {
      const users = await session.run('MATCH (u:User) RETURN count(u) AS c');
      const transactions = await session.run('MATCH (t:Transaction) RETURN count(t) AS c');
      return {
        users: users.records[0].get('c').toNumber(),
        transactions: transactions.records[0].get('c').toNumber(),
      };
    } finally {
      await session.close();
    }
  }
}
