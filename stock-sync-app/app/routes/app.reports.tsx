import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  DataTable,
  BlockStack,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId") || undefined;
  const sku = url.searchParams.get("sku") || undefined;

  const channels = await prisma.shop.findMany({
    where: { isMasterChannel: false },
    select: { id: true, channelName: true, myshopifyDomain: true },
  });

  const where: {
    shopId?: string;
    sku?: { contains: string };
  } = {};

  if (channelId) where.shopId = channelId;
  if (sku) where.sku = { contains: sku };

  const orders = await prisma.channelOrder.findMany({
    where,
    orderBy: { orderedAt: "desc" },
    take: 200,
    include: { shop: true },
  });

  const summary = await prisma.channelOrder.groupBy({
    by: ["shopId", "sku"],
    where: { shopId: channelId },
    _sum: { quantity: true },
    orderBy: [{ shopId: "asc" }, { sku: "asc" }],
  });

  const summaryWithChannel = summary.map((row) => ({
    ...row,
    channel:
      channels.find((c) => c.id === row.shopId)?.channelName ?? row.shopId,
  }));

  return {
    channels: channels.map((c) => ({
      label: c.channelName ?? c.myshopifyDomain,
      value: c.id,
    })),
    orders,
    summary: summaryWithChannel,
    selectedChannelId: channelId,
  };
};

export default function ReportsPage() {
  const { channels, orders, summary, selectedChannelId } =
    useLoaderData<typeof loader>();

  const orderRows = orders.map((order) => [
    order.shop.channelName ?? order.shop.myshopifyDomain,
    order.orderId,
    order.sku,
    order.quantity.toString(),
    new Date(order.orderedAt).toLocaleString(),
  ]);

  const summaryRows = summary.map((row) => [
    row.channel,
    row.sku,
    (row._sum.quantity ?? 0).toString(),
  ]);

  return (
    <Page>
      <TitleBar title="Satış Raporu" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Filtreler</Text>
            <Select
              label="Satış Kanalı"
              options={[
                { label: "Tüm kanallar", value: "" },
                ...channels,
              ]}
              value={selectedChannelId ?? ""}
              onChange={(value) => {
                window.location.search = value ? `?channelId=${value}` : "";
              }}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Kanal × SKU Özeti</Text>
            <DataTable
              columnContentTypes={["text", "text", "numeric"]}
              headings={["Kanal", "SKU", "Toplam Satış Adedi"]}
              rows={
                summaryRows.length ? summaryRows : [["—", "—", "—"]]
              }
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Son Siparişler</Text>
            <DataTable
              columnContentTypes={[
                "text",
                "text",
                "text",
                "numeric",
                "text",
              ]}
              headings={["Kanal", "Sipariş ID", "SKU", "Adet", "Tarih"]}
              rows={orderRows.length ? orderRows : [["—", "—", "—", "—", "—"]]}
            />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
