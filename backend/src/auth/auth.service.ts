import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AccessService } from '../access/access.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly access: AccessService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { accessRole: { select: { key: true, name: true } } },
    });

    if (!user || !user.active || !bcrypt.compareSync(password, user.passwordHash)) {
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    const payload = { sub: user.id, username: user.username, role: user.role };
    // As permissoes vao na resposta (nao no token) para o frontend montar a UI;
    // a autorizacao real e sempre reconsultada no banco a cada requisicao.
    const permissions = [...(await this.access.effectivePermissions(user.id))].sort();

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        roleKey: user.accessRole?.key ?? null,
        roleName: user.accessRole?.name ?? null,
      },
      permissions,
    };
  }
}
