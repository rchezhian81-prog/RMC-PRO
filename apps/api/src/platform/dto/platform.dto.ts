import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

const STATUSES = ['trial', 'active', 'grace', 'suspended', 'cancelled'];

export class CreateTenantUserDto {
  @IsString() @MinLength(2) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}

export class CreateTenantDto {
  @IsString() @MinLength(2) tenantCode!: string;
  @IsString() @MinLength(2) tenantName!: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() planId?: string;
}

export class UpdateTenantDto {
  @IsOptional() @IsString() tenantName?: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsIn(STATUSES) status?: string;
}

export class AssignPlanDto {
  @IsString() planId!: string;
}

export class SetTenantModuleDto {
  @IsBoolean() isEnabled!: boolean;
}

export class CreatePlanDto {
  @IsString() @MinLength(2) planCode!: string;
  @IsString() @MinLength(2) planName!: string;
  @IsOptional() @IsInt() @Min(0) monthlyPrice?: number;
  @IsOptional() @IsInt() @Min(0) yearlyPrice?: number;
  @IsOptional() @IsInt() @Min(1) maxPlants?: number;
  @IsOptional() @IsInt() @Min(1) maxUsers?: number;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() planName?: string;
  @IsOptional() @IsInt() @Min(0) monthlyPrice?: number;
  @IsOptional() @IsInt() @Min(0) yearlyPrice?: number;
  @IsOptional() @IsInt() @Min(1) maxPlants?: number;
  @IsOptional() @IsInt() @Min(1) maxUsers?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SetPlanModulesDto {
  @IsArray() @IsString({ each: true }) moduleKeys!: string[];
}
