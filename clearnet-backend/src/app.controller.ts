import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { NEO4J_DRIVER } from './neo4j/neo4j.module';
import { Driver } from 'neo4j-driver';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health(): Promise<{ status: string; neo4j: string }> {
    try {
      await this.driver.verifyConnectivity();
      return { status: 'ok', neo4j: 'connected' };
    } catch {
      throw new ServiceUnavailableException({ status: 'ko', neo4j: 'unreachable' });
    }
  }
}
