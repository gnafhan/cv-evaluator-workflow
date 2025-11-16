import { Module } from '@nestjs/common';
import { ModelArmorService } from './model-armor.service';
import { PromptInjectionDetectorService } from './prompt-injection-detector.service';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [AIModule],
  providers: [ModelArmorService, PromptInjectionDetectorService],
  exports: [ModelArmorService, PromptInjectionDetectorService],
})
export class SecurityModule {}

