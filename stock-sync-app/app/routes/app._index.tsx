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
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { upsertShopFromSession, setMasterChannel } from "../services/shop.server";
import { runFullSync } from "../services/sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Register current shop and preserve its master role; auto-assign oldest
  // shop as master only when no master exists.
  await upsertShopFromSession(session);

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
  const { admin } = await authenticate.admin(request);

  try {
    const result = await runFullSync(admin);
    return {
      success: true,
      message: `${result.stockUpdated} stok güncellendi, ${result.ordersProcessed} sipariş işlendi.`,
    };
  } catch (error) {
    console.error("Sync failed:", error);
    return {
      success: false,
      message: `Senkronizasyon başarısız: ${(error as Error).message}`,
    };
  }
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
                <Button
                  variant="primary"
                  size="large"
                  onClick={() =>
                    submit(null, { method: "post" })
                  }
                >
                  Şimdi Senkronize Et
                </Button>
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
