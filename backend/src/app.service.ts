import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { execSync } from 'child_process';

@Injectable()
export class AppService {
  private commitSha: string;

  constructor(private prisma: PrismaService) {
    try {
      this.commitSha = process.env.GIT_COMMIT_SHA || execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      this.commitSha = 'UNKNOWN_COMMIT';
    }
  }

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
      environment: process.env.NODE_ENV || 'development',
      version: '0.1.3',
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
      version: '0.1.3',
      commitSha: this.commitSha,
      buildTimestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    };
  }
}
