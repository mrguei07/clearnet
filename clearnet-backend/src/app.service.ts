import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'ClearNet API - Moteur de compensation décentralisée';
  }
}
