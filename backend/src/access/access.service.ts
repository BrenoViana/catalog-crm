import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ROLE_KEY,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  SYSTEM_ROLES,
} from './permission-catalog';

/** Cache curto do conjunto efetivo por usuario — o guard roda em toda rota. */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  permissions: Set<string>;
  expiresAt: number;
}

@Injectable()
export class AccessService implements OnModuleInit {
  private readonly log = new Logger(AccessService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.syncCatalog();
    } catch (err) {
      // Nao derruba o boot: sem catalogo o guard nega por padrao, o que e o
      // comportamento seguro. O log deixa a causa visivel.
      this.log.error(
        `Falha ao sincronizar o catalogo de permissoes: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // ------------------------------------------------------------------ catalogo

  /**
   * Espelha PERMISSION_CATALOG na tabela Permission e garante os papeis
   * internos. Idempotente: roda a cada boot.
   */
  async syncCatalog() {
    for (const [i, def] of PERMISSION_CATALOG.entries()) {
      await this.prisma.permission.upsert({
        where: { key: def.key },
        create: { ...def, sortOrder: i },
        update: {
          group: def.group,
          label: def.label,
          description: def.description ?? null,
          sortOrder: i,
        },
      });
    }

    // Permissoes que sairam do catalogo nao devem continuar concedidas.
    await this.prisma.permission.deleteMany({
      where: { key: { notIn: PERMISSION_KEYS } },
    });

    for (const def of SYSTEM_ROLES) {
      const role = await this.prisma.accessRole.upsert({
        where: { key: def.key },
        create: {
          key: def.key,
          name: def.name,
          description: def.description,
          system: true,
        },
        update: { system: true },
      });

      // Papel interno so tem as permissoes semeadas no PRIMEIRO boot; depois
      // o administrador manda. A excecao e o ADMIN, que sempre recebe tudo —
      // inclusive permissoes novas — para nunca haver sistema sem dono.
      if (def.permissions === '*') {
        await this.prisma.rolePermission.createMany({
          data: PERMISSION_KEYS.map((permissionKey) => ({
            roleId: role.id,
            permissionKey,
          })),
          skipDuplicates: true,
        });
        continue;
      }

      const already = await this.prisma.rolePermission.count({
        where: { roleId: role.id },
      });
      if (already === 0) {
        await this.prisma.rolePermission.createMany({
          data: def.permissions.map((permissionKey) => ({
            roleId: role.id,
            permissionKey,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Usuarios antigos (enum Role) passam a apontar para o papel equivalente.
    const roles = await this.prisma.accessRole.findMany({
      where: { key: { in: SYSTEM_ROLES.map((r) => r.key) } },
      select: { id: true, key: true },
    });
    for (const role of roles) {
      await this.prisma.user.updateMany({
        where: { roleId: null, role: role.key as never },
        data: { roleId: role.id },
      });
    }

    this.invalidate();
    this.log.log(
      `Catalogo de permissoes sincronizado (${PERMISSION_KEYS.length} permissoes, ${SYSTEM_ROLES.length} papeis internos).`,
    );
  }

  listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  // ------------------------------------------------------------------ decisao

  /** Conjunto efetivo: permissoes do papel, com as excecoes do usuario por cima. */
  async effectivePermissions(userId: string): Promise<Set<string>> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.permissions;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        active: true,
        accessRole: { select: { permissions: { select: { permissionKey: true } } } },
        overrides: { select: { permissionKey: true, allow: true } },
      },
    });

    const permissions = new Set<string>();
    if (user?.active) {
      for (const p of user.accessRole?.permissions ?? []) permissions.add(p.permissionKey);
      for (const o of user.overrides) {
        if (o.allow) permissions.add(o.permissionKey);
        else permissions.delete(o.permissionKey);
      }
    }

    this.cache.set(userId, { permissions, expiresAt: Date.now() + CACHE_TTL_MS });
    return permissions;
  }

  async can(userId: string, permission: string) {
    return (await this.effectivePermissions(userId)).has(permission);
  }

  /** Zera o cache (uma mudanca de papel/permissao vale na hora). */
  invalidate(userId?: string) {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  // ------------------------------------------------------------------ papeis

  listRoles() {
    return this.prisma.accessRole.findMany({
      orderBy: [{ system: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { select: { permissionKey: true } },
        _count: { select: { users: true } },
      },
    });
  }

  async createRole(dto: { key: string; name: string; description?: string; permissions: string[] }) {
    const key = dto.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!key) throw new BadRequestException('Chave do papel invalida.');

    const exists = await this.prisma.accessRole.findUnique({ where: { key } });
    if (exists) throw new BadRequestException('Ja existe um papel com esta chave.');

    const role = await this.prisma.accessRole.create({
      data: {
        key,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        system: false,
        permissions: {
          create: this.validKeys(dto.permissions).map((permissionKey) => ({ permissionKey })),
        },
      },
      include: { permissions: { select: { permissionKey: true } } },
    });
    this.invalidate();
    return role;
  }

  async updateRole(
    id: string,
    dto: { name?: string; description?: string; permissions?: string[] },
  ) {
    const role = await this.prisma.accessRole.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Papel nao encontrado.');

    // O Administrador e o ultimo recurso de acesso: nao pode perder permissao.
    if (role.key === ADMIN_ROLE_KEY && dto.permissions) {
      throw new BadRequestException(
        'O papel Administrador tem acesso total por definicao e nao pode ser reduzido.',
      );
    }

    await this.prisma.accessRole.update({
      where: { id },
      data: {
        // Papel interno mantem nome e chave; so as permissoes sao ajustaveis.
        name: role.system ? undefined : dto.name?.trim(),
        description: dto.description?.trim() ?? undefined,
      },
    });

    if (dto.permissions) {
      const keys = this.validKeys(dto.permissions);
      await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
        this.prisma.rolePermission.createMany({
          data: keys.map((permissionKey) => ({ roleId: id, permissionKey })),
          skipDuplicates: true,
        }),
      ]);
    }

    this.invalidate();
    return this.prisma.accessRole.findUnique({
      where: { id },
      include: { permissions: { select: { permissionKey: true } } },
    });
  }

  async removeRole(id: string) {
    const role = await this.prisma.accessRole.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Papel nao encontrado.');
    if (role.system) throw new BadRequestException('Papel interno nao pode ser removido.');
    if (role._count.users > 0) {
      throw new BadRequestException(
        `Ha ${role._count.users} usuario(s) neste papel. Mova-os antes de remover.`,
      );
    }

    await this.prisma.accessRole.delete({ where: { id } });
    this.invalidate();
    return { message: 'Papel removido.' };
  }

  // ------------------------------------------------------------------ usuarios

  listUsers() {
    return this.prisma.user.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        username: true,
        name: true,
        active: true,
        createdAt: true,
        roleId: true,
        accessRole: { select: { id: true, key: true, name: true, system: true } },
        overrides: { select: { permissionKey: true, allow: true } },
      },
    });
  }

  async setUserRole(userId: string, roleId: string) {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.accessRole.findUnique({ where: { id: roleId } }),
    ]);
    if (!user) throw new NotFoundException('Usuario nao encontrado.');
    if (!role) throw new NotFoundException('Papel nao encontrado.');

    await this.guardLastAdmin(userId, { leavingAdmin: role.key !== ADMIN_ROLE_KEY });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { roleId },
      select: { id: true, roleId: true },
    });
    this.invalidate(userId);
    return updated;
  }

  /** Substitui TODAS as excecoes do usuario pelo conjunto informado. */
  async setUserOverrides(
    userId: string,
    overrides: { permissionKey: string; allow: boolean }[],
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario nao encontrado.');

    const valid = overrides.filter((o) => PERMISSION_KEYS.includes(o.permissionKey));
    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId } }),
      this.prisma.userPermission.createMany({
        data: valid.map((o) => ({ userId, permissionKey: o.permissionKey, allow: o.allow })),
        skipDuplicates: true,
      }),
    ]);

    this.invalidate(userId);
    // Uma revogacao pode ter tirado o ultimo administrador do ar.
    await this.assertSomeAdminRemains();
    return { userId, overrides: valid };
  }

  async setUserActive(userId: string, active: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario nao encontrado.');
    if (!active) await this.guardLastAdmin(userId, { leavingAdmin: true });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { active },
      select: { id: true, active: true },
    });
    this.invalidate(userId);
    return updated;
  }

  // ------------------------------------------------------------------ apoio

  private validKeys(keys: string[]) {
    return [...new Set(keys)].filter((k) => PERMISSION_KEYS.includes(k));
  }

  /**
   * Impede tirar o acesso do ultimo usuario capaz de administrar permissoes —
   * o sistema ficaria sem quem consiga desfazer a mudanca.
   */
  private async guardLastAdmin(userId: string, opts: { leavingAdmin: boolean }) {
    if (!opts.leavingAdmin) return;
    const others = await this.countActiveManagers(userId);
    if (others === 0) {
      throw new BadRequestException(
        'Este e o unico usuario ativo que administra permissoes. Promova outro antes.',
      );
    }
  }

  private async assertSomeAdminRemains() {
    if ((await this.countActiveManagers()) === 0) {
      throw new BadRequestException(
        'A mudanca deixaria o sistema sem nenhum usuario capaz de administrar permissoes.',
      );
    }
  }

  /** Usuarios ativos com users.manage efetivo, exceto o informado. */
  private async countActiveManagers(exceptUserId?: string) {
    const users = await this.prisma.user.findMany({
      where: { active: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
      select: { id: true },
    });
    let count = 0;
    for (const u of users) {
      this.cache.delete(u.id);
      if (await this.can(u.id, 'users.manage')) count++;
    }
    return count;
  }
}
