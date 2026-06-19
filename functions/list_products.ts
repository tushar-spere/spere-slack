import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { ProductsDatastore } from "../datastores/products.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const ListProductsFunctionDefinition = DefineFunction({
  callback_id: "list_products_function",
  title: "List Products (Data Table)",
  description:
    "Fetches catalog and posts a rich data table directly to the channel",
  source_file: "functions/list_products.ts",
  input_parameters: {
    properties: { channel_id: { type: Schema.slack.types.channel_id } },
    required: ["channel_id"],
  },
  output_parameters: { properties: {}, required: [] },
});

export default SlackFunction(
  ListProductsFunctionDefinition,
  async ({ inputs, client }) => {
    const { channel_id } = inputs;

    // Bump to V4 config
    const settingsResponse = await client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "v4_final_config",
    });

    let tenantConfig: any[] = [];
    if (
      settingsResponse.ok && settingsResponse.item &&
      settingsResponse.item.custom_fields
    ) {
      tenantConfig = settingsResponse.item.custom_fields;
    }

    const queryResponse = await client.apps.datastore.query({
      datastore: ProductsDatastore.name,
    });

    if (!queryResponse.ok) {
      return { error: `Failed to fetch products: ${queryResponse.error}` };
    }
    const products = queryResponse.items;

    if (products.length === 0) {
      await client.chat.postMessage({
        channel: channel_id,
        text: "The product catalog is empty.",
      });
      return { outputs: {} };
    }

    const headerRow = [
      { type: "raw_text", text: "Product ID" },
      { type: "raw_text", text: "Product Name" },
    ];

    // THE RULE: Only add the column header if show_on_table is true
    tenantConfig.forEach((field) => {
      if (field.show_on_table === true) {
        const safeName = (field.name && String(field.name).trim() !== "")
          ? String(field.name)
          : "Custom Field";
        headerRow.push({ type: "raw_text", text: safeName });
      }
    });

    const tableRows = [headerRow];

    products.forEach((p) => {
      const row = [
        { type: "raw_text", text: String(p.id || "N/A") },
        { type: "raw_text", text: String(p.name || "N/A") },
      ];

      let parsedMetadata: Record<string, any> = {};
      if (p.metadata && typeof p.metadata === "string") {
        try {
          parsedMetadata = JSON.parse(p.metadata);
        } catch (e) {
          console.log(`Failed to parse metadata for product ${p.id}`);
        }
      }

      tenantConfig.forEach((field, index) => {
        // THE RULE: Only add the row data if show_on_table is true
        if (field.show_on_table === true) {
          const metadataKey = `custom_field_${index}`;
          let cellValue = "-";

          if (parsedMetadata[metadataKey]) {
            cellValue = String(parsedMetadata[metadataKey]);
          }
          row.push({ type: "raw_text", text: cellValue });
        }
      });

      tableRows.push(row);
    });

    const uiBlocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Sphere Product Catalog",
          emoji: true,
        },
      },
      {
        type: "data_table",
        caption: "Current Active Products",
        rows: tableRows,
      },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `_Total Items in Database: ${products.length}_`,
        }],
      },
    ];

    const postResponse = await client.chat.postMessage({
      channel: channel_id,
      blocks: uiBlocks,
      text: "Sphere Product Catalog",
    });

    if (!postResponse.ok) {
      return { error: `Failed to post table: ${postResponse.error}` };
    }
    return { outputs: {} };
  },
);
