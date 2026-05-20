import { IsEnum, IsString, IsOptional, IsDateString, MinLength, MaxLength } from 'class-validator';

export enum IntakeEntryType {
  medication = 'medication',
  supplement = 'supplement',
  meal = 'meal',
  beverage = 'beverage',
  therapy = 'therapy',
  exercise = 'exercise',
  symptom = 'symptom',
  sleep = 'sleep',
  protocol_action = 'protocol_action',
  biomarker_event = 'biomarker_event',
  other = 'other',
}

export class CreateIntakeLogDto {
  @IsEnum(IntakeEntryType)
  entryType: IntakeEntryType;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

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

  @IsDateString()
  eventAt: string;
}
