import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private connection: Connection) {}

  @Get()
  async check() {
    const mongoStatus = this.connection.readyState === 1 ? 'connected' : 'disconnected';

    return {
      status: mongoStatus === 'connected' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        mongodb: mongoStatus,
        // Redis and Pinecone health checks would go here
      },
    };
  }
}

