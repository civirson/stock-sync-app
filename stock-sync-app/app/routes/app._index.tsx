import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  Link,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Banner,
  Button,
  DataTable,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate, registerWebhooks } from "../shopify.server";
import prisma from "../db.server";
import { upsertShopFromSession, setMasterChannel } from "../services/shop.server";
import { runFullSync } from "../services/sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Register current shop and preserve its master role; auto-assign oldest
  // shop as master only when no master exists.
  await upsertShopFromSession(session);

  // Register Shopify webhooks automatically every time the app is opened.
  try {
    await registerWebhooks({ session });
  } catch (error) {
    console.error("Webhook registration failed:", error);
  }

  const masterCount = await prisma.shop.count({
    where: { isMasterChannel: true },
  });

  if (masterCount === 0) {
    const oldestShop = await prisma.shop.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (oldestShop) {
      await setMasterChannel(oldestShop.id);
    }
  }

  const masterShop = await prisma.shop.findFirst({
    where: { isMasterChannel: true },
  });

  const channels = await prisma.shop.findMany({
    where: { isMasterChannel: false },
  });

  const mappingsCount = await prisma.productMapping.count();

  const recentOrders = await prisma.channelOrder.findMany({
    take: 5,
    orderBy: { orderedAt: "desc" },
    include: { shop: true },
  });

  const recentLogs = await prisma.inventoryLog.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    include: { shop: true },
  });

  return {
    masterShop,
    channelsCount: channels.length,
    mappingsCount,
    recentOrders,
    recentLogs,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "registerWebhooks") {
    try {
      await registerWebhooks({ session });
      return { success: true, message: "Webhook'lar kaydedildi." };
    } catch (error) {
      console.error("Webhook registration failed:", error);
      return {
        success: false,
        message: `Webhook kaydı başarısız: ${(error as Error).message}`,
      };
    }
  }

  if (intent === "syncStock") {
    try {
      const result = await runFullSync(admin);
      return {
        success: true,
        message: `${result.updatedCount} ürün senkronize edildi.`,
      };
    } catch (error) {
      console.error("Stock sync failed:", error);
      return {
        success: false,
        message: `Senkronizasyon başarısız: ${(error as Error).message}`,
      };
    }
  }

  return null;
};

export default function Index() {
  const {
    masterShop,
    channelsCount,
    mappingsCount,
    recentOrders,
    recentLogs,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const orderRows = recentOrders.map((order) => [
    order.shop.channelName ?? order.shop.myshopifyDomain,
    order.sku,
    order.quantity.toString(),
    new Date(order.orderedAt).toLocaleString(),
  ]);

  const logRows = recentLogs.map((log) => [
    log.shop?.channelName ?? "Ana Mağaza",
    log.sku,
    log.quantityChange.toString(),
    log.reason,
    new Date(log.createdAt).toLocaleString(),
  ]);

  return (
    <Page>
      <TitleBar title="Stok Senkronizasyonu" />
      <BlockStack gap="500">
        {!masterShop && (
          <Banner tone="warning">
            Ana mağaza henüz atanmadı. Bu mağazayı ana mağaza olarak ayarlayın.
          </Banner>
        )}

        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"}>
            {actionData.message}
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Özet
                </Text>
                <InlineStack gap="400">
                  <Badge tone={masterShop ? "success" : "warning"}>
                    {`Ana Mağaza: ${masterShop?.channelName ?? "Atanmadı"}`}
                  </Badge>
                  <Badge tone="info">{`Bağlı Kanal: ${channelsCount}`}</Badge>
                  <Badge tone="info">{`Eşleşen Ürün: ${mappingsCount}`}</Badge>
                </InlineStack>
                <InlineStack gap="300">
                  <Button url="/app/channels">Kanal Yönetimi</Button>
                  <Button url="/app/mapping">Ürün Eşleştirme</Button>
                  <Button url="/app/reports">Satış Raporu</Button>
                </InlineStack>
                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    onClick={() =>
                      submit({ intent: "registerWebhooks" }, { method: "post" })
                    }
                  >
                    Webhook'ları Kur
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() =>
                      submit({ intent: "syncStock" }, { method: "post" })
                    }
                  >
                    Stokları Senkronize Et
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Hızlı Bağlantılar
                </Text>
                <BlockStack gap="200">
                  <Link to="/app/channels">Satış kanalı ekle/kaldır</Link>
                  <Link to="/app/mapping">SKU/barkod eşleştir</Link>
                  <Link to="/app/reports">Kanal bazlı satışları gör</Link>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Son Satışlar</Text>
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "text"]}
                  headings={["Kanal", "SKU", "Adet", "Tarih"]}
                  rows={orderRows.length ? orderRows : [["—", "—", "—", "—"]]}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Son Stok Hareketleri</Text>
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "numeric",
                    "text",
                    "text",
                  ]}
                  headings={["Kanal", "SKU", "Değişim", "Neden", "Tarih"]}
                  rows={logRows.length ? logRows : [["—", "—", "—", "—", "—"]]}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
