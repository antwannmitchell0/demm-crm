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

    // WHEN THIS REQUEST ENTERED THE PROCESS.
    //
    // Refresh-token rotation uses this to tell a concurrent loser apart from a
    // replayer: a request already in flight when the rotation committed is
    // concurrency; one that began afterwards is a replay. Both are refused, but
    // only the replay revokes the session family.
    //
    // IT MUST BE CAPTURED HERE, AT THE HTTP BOUNDARY. Taking it at service-
    // method entry was measured to be far too late: Node processes requests
    // serially through the event loop, so the eighth of eight simultaneous
    // refreshes enters its service method well AFTER the first has committed.
    // Timed from there it looks like a replay, and eight concurrent switches
    // intermittently ended with ZERO live tokens -- the account signed out of
    // every device for the crime of using two tabs.
    (req as unknown as { requestStartedAt: Date }).requestStartedAt =
      new Date();

    next();
  }
}
