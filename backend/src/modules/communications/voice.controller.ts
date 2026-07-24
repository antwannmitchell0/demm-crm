import {
  Controller,
  Post,
  Headers,
  Req,
  UnauthorizedException,
  HttpCode,
  Inject,
} from '@nestjs/common';
import type { Request } from 'express';
import { CallEventService } from './call-event.service';
import { PrismaService } from '../../prisma.service';
import {
  VOICE_PROVIDER,
  type VoiceProvider,
} from './interfaces/voice-provider.interface';

@Controller('webhooks/twilio')
export class TwilioVoiceWebhookController {
  constructor(
    private callEvents: CallEventService,
    private prisma: PrismaService,
    @Inject(VOICE_PROVIDER) private voiceProvider: VoiceProvider,
  ) {}

  // NOTE: because of Task 4.5's raw-body middleware, `req.body` here is a
  // Buffer, NOT a parsed object -- same reasoning as TwilioSmsWebhookController
  // in Task 10. Do not use a `@Body()` DTO decorator here.
  @Post('voice-status')
  @HttpCode(200)
  async handleVoiceStatus(
    @Headers('x-twilio-signature') signature: string,
    @Req() req: Request,
  ) {
    const rawFormBody = (req.body as Buffer).toString('utf-8');
    const url = `${process.env.BACKEND_PUBLIC_URL ?? ''}${req.originalUrl}`;
    if (
      !this.voiceProvider.verifyInboundWebhookSignature(
        rawFormBody,
        signature,
        url,
      )
    ) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }

    const parsedForm = Object.fromEntries(new URLSearchParams(rawFormBody));
    const payload = this.voiceProvider.parseVoiceStatusCallback(parsedForm);

    // Connection is resolved from `payload.to`, which comes from the
    // SIGNED Twilio payload verified above -- not client-supplied input --
    // so this lookup is not an unscoped-by-client-id IDOR (same trust
    // boundary as TwilioSmsWebhookController in Task 10).
    const connection = await this.prisma.channelConnection.findFirst({
      where: { externalAddress: payload.to, type: 'VOICE' },
    });
    if (!connection)
      throw new UnauthorizedException('Unknown destination number');

    await this.callEvents.recordStatusCallback(payload, connection.id);
    return { received: true };
  }
}
