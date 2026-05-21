import {
  IsOptional, IsString, IsDateString, Matches, IsNumber, Min, Max, IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

const BIOLOGICAL_SEX_VALUES = ['male', 'female', 'other', 'prefer_not_to_say'] as const;

export class UpdateProfileDto {
  // ── Personal ────────────────────────────────────────────────────────────────────────────────────
  @IsOptional() @IsString() legalName?: string;

  /** Date of birth as YYYY-MM-DD string. Service converts to Date for Prisma. */
  @IsOptional()
  @IsDateString({}, { message: 'dateOfBirth must be a valid ISO date string (YYYY-MM-DD)' })
  @Matches(/^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'dateOfBirth must be in YYYY-MM-DD format with a 4-digit year between 1900 and 2099',
  })
  dateOfBirth?: string;

  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() postalCode?: string;

  // ── Emergency Contact ──────────────────────────────────────────────────────────────────────────
  @IsOptional() @IsString() emergencyName?: string;
  @IsOptional() @IsString() emergencyPhone?: string;

  // ── Biometrics ─────────────────────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsIn(BIOLOGICAL_SEX_VALUES, {
    message: `biologicalSex must be one of: ${BIOLOGICAL_SEX_VALUES.join(', ')}`,
  })
  biologicalSex?: string;

  /** Height in centimetres */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'height must be a number' })
  @Min(50, { message: 'height must be at least 50 cm' })
  @Max(300, { message: 'height must be at most 300 cm' })
  height?: number;

  /** Weight in kilograms */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'weight must be a number' })
  @Min(1, { message: 'weight must be at least 1 kg' })
  @Max(500, { message: 'weight must be at most 500 kg' })
  weight?: number;

  // ── Health Goals & History ─────────────────────────────────────────────────────────────────────────
  @IsOptional() @IsString() primaryGoal?: string;
  @IsOptional() @IsString() healthGoals?: string;
  @IsOptional() @IsString() medicalHistory?: string;
  @IsOptional() @IsString() currentMeds?: string;
  @IsOptional() @IsString() allergies?: string;
}
