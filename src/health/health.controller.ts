import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorFunction,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    const checks: HealthIndicatorFunction[] = [];

    // Only check database if DATABASE_URL is provided and not explicitly skipped
    if (process.env.DATABASE_URL && process.env.SKIP_DATABASE_HEALTHCHECK !== 'true') {
      checks.push(() => this.prisma.pingCheck('database', this.prismaService));
    }

    if (checks.length === 0) {
      const emptyResult: HealthCheckResult = {
        status: 'ok',
        info: {},
        error: {},
        details: {},
      };
      return emptyResult;
    }

    return this.health.check(checks);
  }
}
