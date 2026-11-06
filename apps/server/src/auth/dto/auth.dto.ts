import { PERMISSIONS, type Permission } from '@my-shop/contracts';
import { IsIn, IsString } from 'class-validator';

export class LoginDto {
  @IsString() code!: string;
  @IsString() terminalId!: string;
}

export class BackOfficeLoginDto {
  @IsString() username!: string;
  @IsString() password!: string;
}

export class ApprovalDto {
  @IsIn([...PERMISSIONS]) permission!: Permission;
  @IsString() code!: string;
}
