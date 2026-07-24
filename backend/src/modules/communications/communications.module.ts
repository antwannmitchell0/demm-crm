import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { SMS_PROVIDER } from './interfaces/sms-provider.interface';
import { VOICE_PROVIDER } from './interfaces/voice-provider.interface';
import { EMAIL_PROVIDER } from './interfaces/email-provider.interface';
import { INBOUND_EMAIL_PROVIDER } from './interfaces/inbound-email-provider.interface';
import { DELIVERY_STATUS_PROVIDER } from './interfaces/delivery-status-provider.interface';
import {
  bindSmsProvider,
  bindVoiceProvider,
  bindEmailProvider,
  bindInboundEmailProvider,
  bindDeliveryStatusProvider,
} from './provider-binding.factory';

@Module({
  providers: [
    PrismaService,
    { provide: SMS_PROVIDER, useFactory: bindSmsProvider },
    { provide: VOICE_PROVIDER, useFactory: bindVoiceProvider },
    { provide: EMAIL_PROVIDER, useFactory: bindEmailProvider },
    { provide: INBOUND_EMAIL_PROVIDER, useFactory: bindInboundEmailProvider },
    {
      provide: DELIVERY_STATUS_PROVIDER,
      useFactory: bindDeliveryStatusProvider,
    },
  ],
  exports: [
    SMS_PROVIDER,
    VOICE_PROVIDER,
    EMAIL_PROVIDER,
    INBOUND_EMAIL_PROVIDER,
    DELIVERY_STATUS_PROVIDER,
  ],
})
export class CommunicationsModule {}
