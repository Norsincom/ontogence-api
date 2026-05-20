import { Module } from '@nestjs/common';
import { AtlasService } from './atlas.service';
import { AtlasController } from './atlas.controller';

@Module({
  controllers: [AtlasController],
  providers: [AtlasService],
  exports: [AtlasService],
})
export class AtlasModule {}
