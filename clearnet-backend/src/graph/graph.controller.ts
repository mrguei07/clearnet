import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { GraphService, DetectedCycle, EgoNetwork } from './graph.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';

/**
 * Visualisation du réseau de compensation (V1.3) — consommée par le Force
 * Graph mobile. GET /api/graph/egonet?depth=2&lat=&lng=
 * Profondeur bornée à [1..3] ; coordonnées optionnelles (marquage urgence).
 */
@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Get('egonet')
  @UseGuards(JwtAuthGuard)
  egonet(
    @CurrentUser() user: CurrentUserPayload,
    @Query('depth') depth?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ): Promise<EgoNetwork> {
    return this.graphService.getEgoNetwork(
      user.email,
      Number(depth) || 2,
      lat ? Number(lat) : undefined,
      lng ? Number(lng) : undefined,
    );
  }

  /** Cycles de dettes de l'utilisateur (2 et 3 maillons) — Phase A. */
  @Get('cycles')
  @UseGuards(JwtAuthGuard)
  cycles(@CurrentUser() user: CurrentUserPayload): Promise<DetectedCycle[]> {
    return this.graphService.detectCycles(user.email);
  }
}
