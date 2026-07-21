import { Module } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [ContactController],
  providers: [ContactService, PrismaService],
  exports: [ContactService],
})
export class ContactModule {}
