import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { CurrentUserPayload } from './current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'clearnet-dev-secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<CurrentUserPayload> {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Jeton invalide');
    }
    return { userId: payload.sub, email: payload.email };
  }
}
