import { PERMISSIONS, type Permission, type Role } from '@my-shop/contracts';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

const ROLES: Role[] = ['cashier', 'supervisor', 'manager', 'owner'];

export class CreateUserDto {
  @IsString() name!: string;
  @IsIn(ROLES) role!: Role;
  @IsString() code!: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() password?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(ROLES) role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() username?: string;
}

export class SetPermissionDto {
  @IsIn(ROLES) role!: Role;
  @IsIn([...PERMISSIONS]) permission!: Permission;
  @IsBoolean() allowed!: boolean;
}
