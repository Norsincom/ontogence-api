import { IsOptional, IsString, IsDateString, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() legalName?: string;
  // Strict YYYY-MM-DD with 4-digit year between 1900 and current year
  @IsOptional()
  @IsDateString()
  @Matches(/^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'dateOfBirth must be a valid date in YYYY-MM-DD format with a 4-digit year between 1900 and 2099',
  })
  dateOfBirth?: string;
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
