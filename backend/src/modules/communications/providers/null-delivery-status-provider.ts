import { Injectable } from '@nestjs/common';
import {
  DeliveryStatusProvider,
  ProviderName,
} from '../interfaces/delivery-status-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullDeliveryStatusProvider implements DeliveryStatusProvider {
  normalizeStatus(
    _providerName: ProviderName,
    _rawEvent: Record<string, unknown>,
  ): never {
    throw new ProviderNotConfiguredError('Delivery status');
  }
}
