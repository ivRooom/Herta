import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    // Rate limitはCloudflareからOriginまでの信頼済みProxy chainを構築してから有効化する。
    // Origin直アクセスを遮断する前にX-Forwarded-Forを信頼すると送信元を偽装でき、
    // 逆にremoteAddressだけを使うと全利用者がnginxの同一IPとして扱われる。
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
