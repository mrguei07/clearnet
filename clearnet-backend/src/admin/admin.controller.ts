import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { AdminService } from './admin.service';

/**
 * V1.4 Axe 1 - Interface d'administration des échecs (DLQ & Retry).
 * Protégée par JWT + rôle admin (ADMIN_EMAILS, vide = tout 403/401).
 */
@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** Jobs en échec (file BullMQ). 503 si QUEUE_ENABLED=false. */
  @Get('queue/failed')
  async failed(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.adminService.listFailed(page, limit);
  }

  /** Audit durable des échecs (Neo4j FailedJob) - disponible file désactivée. */
  @Get('queue/failed-audit')
  async failedAudit(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.adminService.listFailedAudit(page, limit);
  }

  /** Relance d'un job spécifique. */
  @Post('queue/retry/:jobId')
  async retry(@Param('jobId') jobId: string) {
    const ok = await this.adminService.retryJob(jobId);
    if (!ok) {
      throw new HttpException('job not found', HttpStatus.NOT_FOUND);
    }
    return { retried: true, jobId };
  }

  /** Purge de la file (whitelist : onchain-settlement uniquement). */
  @Delete('queue/clean/:queue')
  async clean(@Param('queue') queue: string) {
    await this.adminService.cleanQueue(queue);
    return { cleaned: true, queue };
  }
}