import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateRoleDto {
  @IsString() @MinLength(2) @MaxLength(40)
  key: string;

  @IsString() @MinLength(2) @MaxLength(60)
  name: string;

  @IsOptional() @IsString() @MaxLength(200)
  description?: string;

  @IsArray() @ArrayMaxSize(200) @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60)
  name?: string;

  @IsOptional() @IsString() @MaxLength(200)
  description?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true })
  permissions?: string[];
}

export class SetUserRoleDto {
  @IsString()
  roleId: string;
}

export class UserOverrideDto {
  @IsString()
  permissionKey: string;

  /** true concede a permissao mesmo sem o papel; false revoga mesmo com o papel. */
  @IsBoolean()
  allow: boolean;
}

export class SetUserOverridesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UserOverrideDto)
  overrides: UserOverrideDto[];
}

export class SetUserActiveDto {
  @IsBoolean()
  active: boolean;
}

export class CreateUserDto {
  @IsString() @MinLength(3) @MaxLength(60)
  username: string;

  @IsString() @MinLength(2) @MaxLength(120)
  name: string;

  @IsString() @MinLength(8) @MaxLength(200)
  password: string;

  @IsString()
  roleId: string;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MinLength(3) @MaxLength(60)
  username?: string;
}

export class SetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(200)
  password: string;

  /** Exigida apenas quando a pessoa troca a propria senha. */
  @IsOptional() @IsString() @MaxLength(200)
  currentPassword?: string;
}

export class AuthorizeDto {
  @IsString() @MinLength(1) @MaxLength(60)
  username: string;

  @IsString() @MinLength(1) @MaxLength(200)
  password: string;

  /** Permissao que o operador precisa para concluir a operacao. */
  @IsString() @MinLength(3) @MaxLength(60)
  permission: string;

  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}
