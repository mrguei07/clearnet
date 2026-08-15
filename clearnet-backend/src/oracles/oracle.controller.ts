import { Controller, Get, Query } from '@nestjs/common';
import { OracleService } from './oracle.service';

/** Endpoints de test manuel des oracles (lecture seule). */
@Controller('oracles')
export class OracleController {
  constructor(private readonly oracleService: OracleService) {}

  @Get('demurrage')
  demurrage(@Query('port') port?: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    return this.oracleService.getDemurrageDays(
      port,
      lat ? Number(lat) : undefined,
      lng ? Number(lng) : undefined,
    );
  }

  @Get('launch-window')
  launchWindow(@Query('satellite') satellite?: string) {
    return this.oracleService.getLaunchWindow(satellite);
  }

  @Get('milestone')
  milestone(@Query('nct') nct?: string) {
    return this.oracleService.getMilestoneValidity(nct);
  }
}