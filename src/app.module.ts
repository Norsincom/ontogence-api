import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { VaultModule } from './vault/vault.module';
import { ProtocolsModule } from './protocols/protocols.module';
import { MessagingModule } from './messaging/messaging.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { AdminModule } from './admin/admin.module';
import { StripeModule } from './stripe/stripe.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { EmailModule } from './email/email.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    VaultModule,
    ProtocolsModule,
    MessagingModule,
    MonitoringModule,
    AdminModule,
    StripeModule,
    WebhooksModule,
    EmailModule,
    HealthModule,
    NotificationsModule,
  ],
})
export class AppModule {}
