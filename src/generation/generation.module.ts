import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ImageGenerationController } from './image-generation.controller';
import { GenerationService } from './generation.service';
import { AuthModule } from '../auth/auth.module';
import { R2FilesModule } from '../r2files/r2files.module';
import { R2Service } from '../upload/r2.service';
import { UsageModule } from '../usage/usage.module';
import { PaymentsModule } from '../payments/payments.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProviderHttpService } from './provider-http.service';
import { GeneratedAssetService } from './generated-asset.service';
import { GenerationOrchestrator } from './generation.orchestrator';
import {
  IMAGE_PROVIDER_ADAPTERS,
  ImageProviderRegistry,
} from './providers/image-provider.registry';
import { FluxImageAdapter } from './providers/flux.adapter';
import { GeminiImageAdapter } from './providers/gemini.adapter';
import { IdeogramImageAdapter } from './providers/ideogram.adapter';
import { QwenImageAdapter } from './providers/qwen.adapter';
import { GrokImageAdapter } from './providers/grok.adapter';
import { RunwayImageAdapter } from './providers/runway.adapter';
import { SeedreamImageAdapter } from './providers/seedream.adapter';
import { ChatGptImageAdapter } from './providers/chatgpt.adapter';
import { RecraftImageAdapter } from './providers/recraft.adapter';
import { GEMINI_API_KEY_CANDIDATES } from './constants';

const adapterProviders = [
  {
    provide: FluxImageAdapter,
    useFactory: (configService: ConfigService) =>
      new FluxImageAdapter(
        () => configService.get<string>('BFL_API_KEY'),
        () => configService.get<string>('BFL_API_BASE'),
        (key: string) => configService.get<string>(key),
      ),
    inject: [ConfigService],
  },
  {
    provide: GeminiImageAdapter,
    useFactory: (configService: ConfigService) =>
      new GeminiImageAdapter(() => {
        for (const key of GEMINI_API_KEY_CANDIDATES) {
          const value = configService.get<string>(key);
          if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
          }
        }
        return undefined;
      }),
    inject: [ConfigService],
  },
  {
    provide: IdeogramImageAdapter,
    useFactory: (configService: ConfigService) =>
      new IdeogramImageAdapter(() =>
        configService.get<string>('IDEOGRAM_API_KEY'),
      ),
    inject: [ConfigService],
  },
  {
    provide: QwenImageAdapter,
    useFactory: (configService: ConfigService) =>
      new QwenImageAdapter(
        () => configService.get<string>('DASHSCOPE_API_KEY'),
        () => configService.get<string>('DASHSCOPE_API_BASE'),
      ),
    inject: [ConfigService],
  },
  {
    provide: GrokImageAdapter,
    useFactory: (configService: ConfigService) =>
      new GrokImageAdapter(
        () => configService.get<string>('XAI_API_KEY'),
        () => configService.get<string>('XAI_API_BASE'),
      ),
    inject: [ConfigService],
  },
  {
    provide: RunwayImageAdapter,
    useFactory: (
      configService: ConfigService,
      assetService: GeneratedAssetService,
      httpService: ProviderHttpService,
    ) =>
      new RunwayImageAdapter(
        () => configService.get<string>('RUNWAY_API_KEY'),
        assetService,
        httpService,
      ),
    inject: [ConfigService, GeneratedAssetService, ProviderHttpService],
  },
  {
    provide: SeedreamImageAdapter,
    useFactory: (
      configService: ConfigService,
      assetService: GeneratedAssetService,
      httpService: ProviderHttpService,
    ) =>
      new SeedreamImageAdapter(
        () => configService.get<string>('ARK_API_KEY'),
        assetService,
        httpService,
      ),
    inject: [ConfigService, GeneratedAssetService, ProviderHttpService],
  },
  {
    provide: ChatGptImageAdapter,
    useFactory: (
      configService: ConfigService,
      assetService: GeneratedAssetService,
      httpService: ProviderHttpService,
    ) =>
      new ChatGptImageAdapter(
        () => configService.get<string>('OPENAI_API_KEY'),
        assetService,
        httpService,
      ),
    inject: [ConfigService, GeneratedAssetService, ProviderHttpService],
  },
  {
    provide: RecraftImageAdapter,
    useFactory: (
      configService: ConfigService,
      assetService: GeneratedAssetService,
    ) =>
      new RecraftImageAdapter(
        () => configService.get<string>('RECRAFT_API_KEY'),
        assetService,
      ),
    inject: [ConfigService, GeneratedAssetService],
  },
];

const registryProvider = {
  provide: IMAGE_PROVIDER_ADAPTERS,
  useFactory: (
    flux: FluxImageAdapter,
    gemini: GeminiImageAdapter,
    ideogram: IdeogramImageAdapter,
    qwen: QwenImageAdapter,
    grok: GrokImageAdapter,
    runway: RunwayImageAdapter,
    seedream: SeedreamImageAdapter,
    chatgpt: ChatGptImageAdapter,
    recraft: RecraftImageAdapter,
  ) => [flux, gemini, ideogram, qwen, grok, runway, seedream, chatgpt, recraft],
  inject: [
    FluxImageAdapter,
    GeminiImageAdapter,
    IdeogramImageAdapter,
    QwenImageAdapter,
    GrokImageAdapter,
    RunwayImageAdapter,
    SeedreamImageAdapter,
    ChatGptImageAdapter,
    RecraftImageAdapter,
  ],
};

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    R2FilesModule,
    UsageModule,
    PaymentsModule,
    forwardRef(() => JobsModule),
  ],
  controllers: [ImageGenerationController],
  providers: [
    ProviderHttpService,
    GeneratedAssetService,
    ...adapterProviders,
    registryProvider,
    ImageProviderRegistry,
    GenerationService,
    GenerationOrchestrator,
    R2Service,
  ],
  exports: [
    GenerationService,
    GeneratedAssetService,
    ProviderHttpService,
    ImageProviderRegistry,
    GenerationOrchestrator,
  ],
})
export class GenerationModule { }
