import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

const WEBHOOK_TOPICS = [
  { topic: "ORDERS_CREATE", path: "/webhooks/orders/create" },
  {
    topic: "INVENTORY_LEVELS_UPDATE",
    path: "/webhooks/inventory_levels/update",
  },
] as const;

interface WebhookSubscriptionNode {
  id: string;
  topic: string;
  callbackUrl: string;
}

export async function ensureWebhooks(admin: AdminApiContext, appUrl: string) {
  const baseUrl = appUrl.replace(/\/$/, "");

  try {
    const listResponse = await admin.graphql(
      `#graphql
      query getWebhooks {
        webhookSubscriptions(first: 50) {
          edges {
            node {
              id
              topic
              callbackUrl
            }
          }
        }
      }`,
    );
    const listData = (await listResponse.json()) as {
      data?: {
        webhookSubscriptions?: {
          edges?: Array<{ node: WebhookSubscriptionNode }>;
        };
      };
    };
    const existing =
      listData.data?.webhookSubscriptions?.edges?.map((edge) => edge.node) ??
      [];

    for (const { topic, path } of WEBHOOK_TOPICS) {
      const callbackUrl = `${baseUrl}${path}`;
      const alreadyExists = existing.some(
        (subscription) =>
          subscription.topic === topic &&
          subscription.callbackUrl === callbackUrl,
      );

      if (alreadyExists) {
        console.log(`Webhook ${topic} already registered`);
        continue;
      }

      const createResponse = await admin.graphql(
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
              callbackUrl,
              format: "JSON",
            },
          },
        },
      );

      const createData = (await createResponse.json()) as {
        data?: {
          webhookSubscriptionCreate?: {
            userErrors?: Array<{ field: string; message: string }>;
            webhookSubscription?: { id: string };
          };
        };
      };
      const errors = createData.data?.webhookSubscriptionCreate?.userErrors;
      if (errors && errors.length > 0) {
        console.warn(`Webhook ${topic} registration warnings:`, errors);
      } else {
        console.log(`Webhook ${topic} registered at ${callbackUrl}`);
      }
    }
  } catch (error) {
    console.error("Failed to ensure webhooks:", error);
  }
}
