import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    HealthModule,
    // 以下のモジュールは Phase 1 以降で追加:
    // AuthModule,
    // GuildModule,
    // UserModule,
    // RbacModule,
    // AuditModule,
    // PluginModule,
    // RuleEngineModule,
    // PrismaModule,
    // RedisModule,
  ],
})
export class AppModule {}
