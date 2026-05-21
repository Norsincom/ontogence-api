import { IsEnum, IsString, IsOptional, IsDateString, MinLength, MaxLength } from 'class-validator';
import { IntakeEntryType } from './create-intake-log.dto';

/**
 * UpdateIntakeLogDto — all fields optional, mirrors CreateIntakeLogDto.
 * Explicitly defined to avoid @nestjs/mapped-types peer-dependency issues
 * while maintaining full type safety and DTO parity.
 */
export class UpdateIntakeLogDto {
  @IsOptional()
  @IsEnum(IntakeEntryType)
  entryType?: IntakeEntryType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  route?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;

  @IsOptional()
  @IsDateString()
  eventAt?: string;
}
