import {
  IsString, IsOptional, IsBoolean, IsDateString, MaxLength, MinLength,
} from 'class-validator';

export class CreatePrescriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  medicationName: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  strength?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  frequency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  route?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  prescribingPhysician?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pharmacy?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
