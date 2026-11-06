import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RegisterMemberDto {
  @IsString() phone!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() birthday?: string;
  @IsBoolean() consent!: boolean;
}

export class UpdateMemberDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() birthday?: string | null;
  @IsOptional() @IsString() tier?: string;
  @IsOptional() tax?: unknown;
}
