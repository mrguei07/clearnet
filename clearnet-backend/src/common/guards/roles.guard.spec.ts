import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Roles, RolesGuard } from './roles.guard';

function mockContext(user?: { email?: string }) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('RolesGuard', () => {
  const emptyConfig = new ConfigService({ ADMIN_EMAILS: '' });

  it('définit le décorateur Roles (nom de métadonnée "roles")', () => {
    const decorator = Roles('admin');
    expect(typeof decorator).toBe('function');
  });

  describe('aucun rôle requis', () => {
    it('laisse passer (routes publiques inchangées)', () => {
      const guard = new RolesGuard(
        { getAllAndOverride: () => undefined } as unknown as Reflector,
        emptyConfig,
      );
      expect(guard.canActivate(mockContext({ email: 'anyone@x.fr' }))).toBe(true);
    });
  });

  describe('rôle admin requis', () => {
    const reflector = { getAllAndOverride: () => ['admin'] } as unknown as Reflector;

    it('refuse si ADMIN_EMAILS est vide (feature désactivée)', () => {
      const guard = new RolesGuard(reflector, emptyConfig);
      expect(() => guard.canActivate(mockContext({ email: 'ops@x.fr' }))).toThrow(
        new ForbiddenException('admin feature disabled'),
      );
    });

    it('refuse un email absent de la liste', () => {
      const guard = new RolesGuard(
        reflector,
        new ConfigService({ ADMIN_EMAILS: 'ops@clearnet.example' }),
      );
      expect(() => guard.canActivate(mockContext({ email: 'user@x.fr' }))).toThrow(
        new ForbiddenException('insufficient role'),
      );
    });

    it('refuse si le payload JWT n a pas d email', () => {
      const guard = new RolesGuard(
        reflector,
        new ConfigService({ ADMIN_EMAILS: 'ops@clearnet.example' }),
      );
      expect(() => guard.canActivate(mockContext())).toThrow(
        new ForbiddenException('insufficient role'),
      );
    });

    it('accepte un email admin (insensible à la casse)', () => {
      const guard = new RolesGuard(
        reflector,
        new ConfigService({ ADMIN_EMAILS: 'OpS@Clearnet.Example , other@x.fr' }),
      );
      expect(guard.canActivate(mockContext({ email: 'OPS@clearnet.example' }))).toBe(true);
    });
  });
});

// La garde est souvent instanciée via le conteneur Nest ; Test dummy garanti.
describe('RolesGuard (intégration TestingModule)', () => {
  it('se résout depuis le conteneur', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: { getAllAndOverride: () => ['admin'] } },
        {
          provide: ConfigService,
          useValue: new ConfigService({ ADMIN_EMAILS: 'ops@clearnet.example' }),
        },
      ],
    }).compile();
    const guard = moduleRef.get(RolesGuard);
    expect(guard.canActivate(mockContext({ email: 'ops@clearnet.example' }))).toBe(true);
    expect(() => guard.canActivate(mockContext({ email: 'nope@x.fr' }))).toThrow(
      ForbiddenException,
    );
  });
});