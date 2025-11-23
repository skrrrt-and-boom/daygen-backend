import { Inject, Injectable } from '@nestjs/common';
import type { ImageProviderAdapter } from '../types';

export const IMAGE_PROVIDER_ADAPTERS = Symbol('IMAGE_PROVIDER_ADAPTERS');

@Injectable()
export class ImageProviderRegistry {
  constructor(
    @Inject(IMAGE_PROVIDER_ADAPTERS)
    private readonly adapters: ImageProviderAdapter[],
  ) {}

  getAdapterForModel(model?: string | null): ImageProviderAdapter | undefined {
    if (!model) {
      return undefined;
    }
    const normalized = model.trim();
    if (!normalized) {
      return undefined;
    }
    return this.adapters.find((adapter) => adapter.canHandleModel(normalized));
  }

  getAllAdapters(): ImageProviderAdapter[] {
    return [...this.adapters];
  }
}

