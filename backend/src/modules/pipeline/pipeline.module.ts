import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [PipelineController],
  providers: [PipelineService, PrismaService],
  exports: [PipelineService],
})
export class PipelineModule {}
