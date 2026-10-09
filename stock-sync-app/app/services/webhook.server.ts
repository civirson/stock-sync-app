import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

const WEBHOOK_TOPICS = [
  { topic: "ORDERS_CREATE", path: "/webhooks/orders/create" },
  {
    topic: "INVENTORY_LEVELS_UPDATE",
    path: "/webhooks/inventory_levels/update",
  },
] as const;

export async function ensureWebhooks(admin: AdminApiContext, appUrl: string) {
  for (const { topic, path } of WEBHOOK_TOPICS) {
    try {
      const response = await admin.graphql(
        `#graphql
        mutation createWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            userErrors { field message }
            webhookSubscription { id }
          }
        }`,
        {
          variables: {
            topic,
            webhookSubscription: {
              callbackUrl: `${appUrl.replace(/\/$/, "")}${path}`,
              format: "JSON",
            },
          },
        },
      );

      const responseData = await response.json();
      const errors = responseData?.data?.webhookSubscriptionCreate?.userErrors;
      if (errors?.length) {
        console.warn(`Webhook ${topic} registration warnings:`, errors);
      } else {
        console.log(`Webhook ${topic} registered at ${appUrl}${path}`);
      }
    } catch (error) {
      console.error(`Failed to register webhook ${topic}:`, error);
    }
  }
}
