import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Button,
  Select,
  DataTable,
  BlockStack,
  Banner,
  FormLayout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate, unauthenticated } from "../shopify.server";
import {
  getConnectedChannels,
  getMasterShop,
} from "../services/shop.server";
import {
  createOrUpdateMapping,
  deleteMapping,
  getMappingsByShop,
} from "../services/mapping.server";

interface ProductOption {
  label: string;
  value: string;
  sku?: string;
  barcode?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const masterShop = await getMasterShop();
  const channels = await getConnectedChannels();

  const url = new URL(request.url);
  const selectedChannelId = url.searchParams.get("channelId");

  // Fetch master products
  const masterResponse = await admin.graphql(
    `#graphql
    query GetMasterProducts($first: Int!) {
      products(first: $first) {
        edges {
          node {
            id
            title
            variants(first: 50) {
              edges {
                node {
                  id
                  sku
                  barcode
                  title
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { first: 100 } },
  );

  const masterJson = (await masterResponse.json()) as {
    data?: {
      products: {
        edges: Array<{
          node: {
            id: string;
            title: string;
            variants: {
              edges: Array<{
                node: {
                  id: string;
                  sku?: string;
                  barcode?: string;
                  title: string;
                };
              }>;
            };
          };
        }>;
      };
    };
  };

  const masterOptions: ProductOption[] = [];
  masterJson.data?.products.edges.forEach(({ node }) => {
    node.variants.edges.forEach(({ node: variant }) => {
      if (variant.sku) {
        masterOptions.push({
          label: `${node.title} — ${variant.title} (${variant.sku})`,
          value: variant.id,
          sku: variant.sku,
          barcode: variant.barcode,
        });
      }
    });
  });

  // Fetch channel products if a channel is selected
  let channelOptions: ProductOption[] = [];
  let mappings: Awaited<ReturnType<typeof getMappingsByShop>> = [];

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);
  if (selectedChannel) {
    const { admin: channelAdmin } = await unauthenticated.admin(
      selectedChannel.myshopifyDomain,
    );
    const channelResponse = await channelAdmin.graphql(
      `#graphql
      query GetChannelProducts($first: Int!) {
        products(first: $first) {
          edges {
            node {
              id
              title
              variants(first: 50) {
                edges {
                  node {
                    id
                    sku
                    barcode
                    title
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { first: 100 } },
    );

    const channelJson = (await channelResponse.json()) as {
      data?: {
        products: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              variants: {
                edges: Array<{
                  node: {
                    id: string;
                    sku?: string;
                    barcode?: string;
                    title: string;
                  };
                }>;
              };
            };
          }>;
        };
      };
    };

    channelJson.data?.products.edges.forEach(({ node }) => {
      node.variants.edges.forEach(({ node: variant }) => {
        if (variant.sku) {
          channelOptions.push({
            label: `${node.title} — ${variant.title} (${variant.sku})`,
            value: variant.id,
            sku: variant.sku,
            barcode: variant.barcode,
          });
        }
      });
    });

    mappings = await getMappingsByShop(selectedChannel.id);
  }

  return {
    masterShop,
    channels: channels.map((c) => ({
      label: c.channelName ?? c.myshopifyDomain,
      value: c.id,
    })),
    selectedChannelId,
    masterOptions,
    channelOptions,
    mappings,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const shopId = formData.get("shopId") as string;
    const masterVariantId = formData.get("masterVariantId") as string;
    const channelVariantId = formData.get("channelVariantId") as string;
    const sku = formData.get("sku") as string;
    const barcode = formData.get("barcode") as string;

    if (!shopId || !masterVariantId || !channelVariantId || !sku) {
      return { error: "Tüm zorunlu alanları doldurun." };
    }

    await createOrUpdateMapping({
      shopId,
      masterVariantId,
      channelVariantId,
      sku,
      barcode: barcode || undefined,
    });

    return { success: true };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await deleteMapping(id);
    return { success: true };
  }

  return null;
};

export default function MappingPage() {
  const {
    channels,
    selectedChannelId,
    masterOptions,
    channelOptions,
    mappings,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const [channelId, setChannelId] = useState(selectedChannelId ?? "");
  const [masterVariantId, setMasterVariantId] = useState("");
  const [channelVariantId, setChannelVariantId] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");

  const handleMasterChange = (value: string) => {
    setMasterVariantId(value);
    const option = masterOptions.find((o) => o.value === value);
    if (option?.sku) setSku(option.sku);
    if (option?.barcode) setBarcode(option.barcode);
  };

  const handleChannelChange = (value: string) => {
    setChannelVariantId(value);
    const option = channelOptions.find((o) => o.value === value);
    if (option?.sku && !sku) setSku(option.sku);
    if (option?.barcode && !barcode) setBarcode(option.barcode);
  };

  const mappingRows = mappings.map((m) => [
    m.sku,
    m.barcode ?? "—",
    masterOptions.find((o) => o.value === m.masterVariantId)?.label ?? m.masterVariantId,
    channelOptions.find((o) => o.value === m.channelVariantId)?.label ?? m.channelVariantId,
    <Button
      key={m.id}
      tone="critical"
      size="micro"
      onClick={() =>
        submit(
          { intent: "delete", id: m.id },
          { method: "post", replace: true },
        )
      }
    >
      Sil
    </Button>,
  ]);

  return (
    <Page>
      <TitleBar title="Ürün Eşleştirme" />
      <BlockStack gap="500">
        <Banner tone="info">
          Ana mağaza ile satış kanalı arasındaki ürünleri SKU veya barkod
          üzerinden eşleştirin. Sadece SKU’su olan varyantlar listelenir.
        </Banner>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Kanal Seçimi</Text>
            <Select
              label="Satış Kanalı"
              options={[{ label: "Kanal seçin", value: "" }, ...channels]}
              value={channelId}
              onChange={(value) => {
                setChannelId(value);
                window.location.search = value ? `?channelId=${value}` : "";
              }}
            />
          </BlockStack>
        </Card>

        {channelId && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Yeni Eşleştirme</Text>
                  <FormLayout>
                    <Select
                      label="Ana Mağaza Varyantı"
                      options={[
                        { label: "Varyant seçin", value: "" },
                        ...masterOptions,
                      ]}
                      value={masterVariantId}
                      onChange={handleMasterChange}
                    />
                    <Select
                      label="Kanal Varyantı"
                      options={[
                        { label: "Varyant seçin", value: "" },
                        ...channelOptions,
                      ]}
                      value={channelVariantId}
                      onChange={handleChannelChange}
                    />
                    <TextField
                      label="SKU"
                      value={sku}
                      onChange={setSku}
                      autoComplete="off"
                    />
                    <TextField
                      label="Barkod"
                      value={barcode}
                      onChange={setBarcode}
                      autoComplete="off"
                    />
                    <Button
                      variant="primary"
                      onClick={() => {
                        submit(
                          {
                            intent: "add",
                            shopId: channelId,
                            masterVariantId,
                            channelVariantId,
                            sku,
                            barcode,
                          },
                          { method: "post", replace: true },
                        );
                        setMasterVariantId("");
                        setChannelVariantId("");
                        setSku("");
                        setBarcode("");
                      }}
                    >
                      Eşleştir
                    </Button>
                  </FormLayout>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Mevcut Eşleştirmeler</Text>
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "SKU",
                      "Barkod",
                      "Ana Varyant",
                      "Kanal Varyant",
                      "İşlem",
                    ]}
                    rows={
                      mappingRows.length
                        ? mappingRows
                        : [["—", "—", "—", "—", "—"]]
                    }
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}
      </BlockStack>
    </Page>
  );
}
