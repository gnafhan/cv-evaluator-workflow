import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const config = configService.get<{
          redis: { host: string; port: number; password?: string };
        }>('app');

        return {
          connection: {
            host: config?.redis.host || 'localhost',
            port: config?.redis.port || 6379,
            password: config?.redis.password,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}

