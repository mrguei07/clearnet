import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('AdminController', () => {
  let controller: AdminController;
  const adminService = {
    listFailed: jest.fn(),
    listFailedAudit: jest.fn(),
    retryJob: jest.fn(),
    cleanQueue: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: adminService }],
    }).compile();
    controller = moduleRef.get(AdminController);
  });

  it('liste les jobs en échec avec pagination', async () => {
    adminService.listFailed.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    await expect(controller.failed(1, 20)).resolves.toEqual(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(adminService.listFailed).toHaveBeenCalledWith(1, 20);
  });

  it('liste l audit Neo4j des échecs définitifs', async () => {
    adminService.listFailedAudit.mockResolvedValue({ items: [], total: 0, page: 2, limit: 10 });
    await expect(controller.failedAudit(2, 10)).resolves.toEqual(
      expect.objectContaining({ page: 2, limit: 10 }),
    );
    expect(adminService.listFailedAudit).toHaveBeenCalledWith(2, 10);
  });

  it('relance un job et renvoie 404 si inconnu', async () => {
    adminService.retryJob.mockResolvedValue(true);
    await expect(controller.retry('job-1')).resolves.toEqual({ retried: true, jobId: 'job-1' });
    expect(adminService.retryJob).toHaveBeenCalledWith('job-1');

    adminService.retryJob.mockResolvedValue(false);
    await expect(controller.retry('missing')).rejects.toEqual(
      new HttpException('job not found', HttpStatus.NOT_FOUND),
    );
  });

  it('refuse la purge d une file non whitelistée', async () => {
    adminService.cleanQueue.mockRejectedValue(
      new HttpException(
        'queue whitelisted: onchain-settlement only',
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    );
    await expect(controller.clean('other')).rejects.toBeInstanceOf(HttpException);
  });

  it('purge la file onchain-settlement', async () => {
    adminService.cleanQueue.mockResolvedValue(undefined);
    await expect(controller.clean('onchain-settlement')).resolves.toEqual({
      cleaned: true,
      queue: 'onchain-settlement',
    });
  });
});