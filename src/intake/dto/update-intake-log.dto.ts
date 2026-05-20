import { PartialType } from '@nestjs/mapped-types';
import { CreateIntakeLogDto } from './create-intake-log.dto';

export class UpdateIntakeLogDto extends PartialType(CreateIntakeLogDto) {}
