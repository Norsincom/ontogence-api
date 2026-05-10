import { IsOptional, IsString, IsDateString } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() emergencyName?: string;
  @IsOptional() @IsString() emergencyPhone?: string;
  @IsOptional() @IsString() healthGoals?: string;
  @IsOptional() @IsString() medicalHistory?: string;
  @IsOptional() @IsString() currentMeds?: string;
  @IsOptional() @IsString() allergies?: string;
}
