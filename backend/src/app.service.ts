import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  getHello(): string {
    return 'DEMM CRM Operational Engine API';
  }

  async getHealth() {
    let dbStatus = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'down';
    }

    return {
      status: 'ok',
      database: dbStatus,
      environment: process.env.NODE_ENV || 'staging',
      version: '0.1.2',
    };
  }

  async getReady() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'connected' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        error: 'Critical dependency unavailable: database connection failed',
      });
    }
  }

  getVersion() {
    return {
      version: '0.1.2',
      commitSha: '50af85e6ef1a83ee10ffbc0cb9d7d42cfbc1bfd7',
      buildTimestamp: '2026-07-21T05:20:00.000Z',
      environment: process.env.NODE_ENV || 'staging',
    };
  }
}
