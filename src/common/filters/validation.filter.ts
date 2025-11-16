import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(BadRequestException)
export class ValidationFilter implements ExceptionFilter {
  private readonly logger = new Logger(ValidationFilter.name);

  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message = 'Validation failed';
    let errors: string[] = [];

    if (typeof exceptionResponse === 'object') {
      const responseObj = exceptionResponse as any;
      message = responseObj.message || message;
      
      if (Array.isArray(responseObj.message)) {
        errors = responseObj.message;
      } else if (typeof responseObj.message === 'string') {
        errors = [responseObj.message];
      }
    }

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      errors,
    };

    response.status(status).json(errorResponse);
  }
}

