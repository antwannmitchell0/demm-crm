import { Injectable } from '@nestjs/common';
import { DeliveryStatusProvider } from '../interfaces/delivery-status-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullDeliveryStatusProvider implements DeliveryStatusProvider {
  normalizeStatus(): never {
    throw new ProviderNotConfiguredError('Delivery status');
  }
}
