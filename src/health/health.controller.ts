import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorFunction,
  PrismaHealthIndicator,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    const checks: HealthIndicatorFunction[] = [];

    if (process.env.SKIP_DATABASE_HEALTHCHECK !== 'true') {
      checks.push(() => this.prisma.pingCheck('database'));
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
