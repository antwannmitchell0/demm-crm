import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const headerName = 'x-correlation-id';
    const correlationId =
      (req.headers[headerName] as string) || crypto.randomUUID();

    req.headers[headerName] = correlationId;
    res.setHeader(headerName, correlationId);

    next();
  }
}
