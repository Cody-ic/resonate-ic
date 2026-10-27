import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { drainQueue } from "../lib/moderation";
import {kickMailQueue} from "../lib/notifications";
export {ReviewCoordinator,ReviewWorkflow} from './review-runtime';

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    if(["POST","PATCH","DELETE"].includes(request.method)&&response.ok&&/^\/api\/(projects|courses|resource-offers|topics|reports|technical-feedback|admin)(\/|$)/.test(new URL(request.url).pathname)){
      ctx.waitUntil(drainQueue());
      ctx.waitUntil(kickMailQueue());
    }
    return response;
  },
  async scheduled(_controller:ScheduledController,_env:Cloudflare.Env,ctx:ExecutionContext){
    ctx.waitUntil(drainQueue());
    ctx.waitUntil(kickMailQueue());
  },
};

export default worker;
