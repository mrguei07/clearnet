import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NEO4J_DRIVER } from './neo4j/neo4j.module';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: NEO4J_DRIVER,
          useValue: { verifyConnectivity: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('devrait retourner le message de bienvenue', () => {
      expect(appController.getHello()).toContain('ClearNet');
    });
  });

  describe('health', () => {
    it('devrait retourner ok quand Neo4j est joignable', async () => {
      await expect(appController.health()).resolves.toEqual({
        status: 'ok',
        neo4j: 'connected',
      });
    });
  });
});
