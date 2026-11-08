import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Express, Request, Response } from 'express';

export interface PendingFlow {
  id: string;
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  createdAt: number;
}

export interface LoginContext {
  baseUrl: string;
  mealieUrl: string;
  /** Single use: removes the flow. A method that lets the user retry re-registers it with {@link renewFlow}. */
  takeFlow(id: string): PendingFlow | undefined;
  renewFlow(flow: PendingFlow): PendingFlow;
  /** Every method ends here: turns a Mealie session into a stored grant and redirects back to the client. */
  completeLogin(flow: PendingFlow, sessionJwt: string, res: Response): Promise<void>;
  clientIp(req: Request): string;
}

/** One way of proving who the user is. Password login today; OIDC plugs in here later. */
export interface LoginMethod {
  id: 'password' | 'oidc';
  /** Paths this method serves, beyond the standard OAuth endpoints. */
  paths: string[];
  register(app: Express, context: LoginContext): void;
  begin(flow: PendingFlow, res: Response): void;
}
