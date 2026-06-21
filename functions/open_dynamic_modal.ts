import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { ProductsDatastore } from "../datastores/products.ts";
import { QuotesDatastore } from "../datastores/quotes.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const OpenDynamicModalDefinition = DefineFunction({
  callback_id: "open_dynamic_modal_function",
  title: "Open Dynamic Modal",
  description: "Dynamically generates a UI based on tenant configuration",
  source_file: "functions/open_dynamic_modal.ts",
  input_parameters: {
    properties: {
      interactivity: { type: Schema.slack.types.interactivity },
      schema_id: { type: Schema.types.string },
    },
    required: ["interactivity", "schema_id"],
  },
  output_parameters: {
    properties: {
      quote_id: { type: Schema.types.string },
      customer_name: { type: Schema.types.string },
      total_amount: { type: Schema.types.number },
    },
    required: ["quote_id", "customer_name", "total_amount"],
  },
});

function buildDynamicElement(field: any, actionId: string) {
  switch (field.type) {
    case "plain_text_input_multi":
      return { type: "plain_text_input", action_id: actionId, multiline: true };
    case "datepicker":
      return { type: "datepicker", action_id: actionId };
    case "timepicker":
      return { type: "timepicker", action_id: actionId };
    case "multi_users_select":
      return { type: "multi_users_select", action_id: actionId };
    case "static_select":
    case "multi_static_select": {
      const rawOptions =
        (field.dropdown_options && field.dropdown_options.length > 0)
          ? field.dropdown_options
          : ["No Options Configured"];
      const blockKitOptions = rawOptions.map((opt: string) => ({
        text: { type: "plain_text", text: String(opt).substring(0, 75) },
        value: String(opt).substring(0, 75),
      }));
      return {
        type: field.type,
        action_id: actionId,
        placeholder: { type: "plain_text", text: "Select an option..." },
        options: blockKitOptions,
      };
    }
    case "plain_text_input":
    default:
      return { type: "plain_text_input", action_id: actionId };
  }
}

async function buildStepTwoView(client: any, quoteId: string) {
  const refreshId = Math.floor(Math.random() * 1_000_000);

  const quoteRes = await client.apps.datastore.get({
    datastore: QuotesDatastore.name,
    id: quoteId,
  });
  const quote = quoteRes.item;
  const lineItems = quote?.line_items ? JSON.parse(quote.line_items) : [];

  const prodRes = await client.apps.datastore.query({
    datastore: ProductsDatastore.name,
  });
  const products = prodRes.items || [];
  const productOptions = products.slice(0, 100).map((p: any) => ({
    text: { type: "plain_text", text: String(p.name).substring(0, 75) },
    value: String(p.id),
  }));

  if (productOptions.length === 0) {
    productOptions.push({
      text: { type: "plain_text", text: "No products exist yet!" },
      value: "none",
    });
  }

  const lineItemSchemaRes = await client.apps.datastore.get({
    datastore: TenantSettingsDatastore.name,
    id: "schema_quote_product",
  });
  const lineItemCustomFields: any[] = lineItemSchemaRes.item?.custom_fields ||
    [];

  const blocks: any[] = [{
    type: "header",
    text: { type: "plain_text", text: "Line Items for Quote #" + quoteId },
  }];

  if (lineItems.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No products attached to this quote yet._",
      },
    });
  } else {
    lineItems.forEach((item: any) => {
      let specPreview = "";
      if (item.customSpecs && Object.keys(item.customSpecs).length > 0) {
        specPreview = "\n   ↳ " +
          Object.entries(item.customSpecs).map(([k, v]) => "*" + k + ":* " + v)
            .join(" | ");
      }
      const qNum = parseInt(item.qty) || 1;
      const uPrice = parseFloat(item.unitPrice ?? 100) || 0;
      const subCalc = qNum * uPrice;

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "📦 *" + item.productName + "* | _Qty:_ " + qNum + " (@ $" +
            uPrice.toLocaleString() + ") — *$" + subCalc.toLocaleString() +
            "*" + specPreview,
        },
      });
    });
  }

  blocks.push({ type: "divider" }, {
    type: "section",
    text: { type: "mrkdwn", text: "*Attach a Product*" },
  });

  blocks.push({
    type: "input",
    block_id: `product_select_block_${refreshId}`,
    optional: true,
    element: {
      type: "static_select",
      action_id: "product_select",
      placeholder: { type: "plain_text", text: "Select a Product..." },
      options: productOptions,
    },
    label: { type: "plain_text", text: "Product Catalog" },
  });

  blocks.push({
    type: "input",
    block_id: `qty_input_block_${refreshId}`,
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "qty_input",
      placeholder: { type: "plain_text", text: "e.g., 5" },
    },
    label: { type: "plain_text", text: "Quantity" },
  });

  // THE MANUAL PRICE INPUT:
  blocks.push({
    type: "input",
    block_id: `unit_price_input_block_${refreshId}`,
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "unit_price_input",
      placeholder: { type: "plain_text", text: "e.g., 250.00" },
    },
    label: { type: "plain_text", text: "Unit Price ($)" },
  });

  lineItemCustomFields.forEach((fieldBlob, idx) => {
    if (fieldBlob.show_on_form === true) {
      blocks.push({
        type: "input",
        block_id: `item_custom_${idx}_${refreshId}`,
        optional: fieldBlob.required !== true,
        element: buildDynamicElement(fieldBlob, `item_act_${idx}`),
        label: {
          type: "plain_text",
          text: fieldBlob.name || `Spec ${idx + 1}`,
        },
      });
    }
  });

  blocks.push({
    type: "actions",
    block_id: "add_item_actions",
    elements: [{
      type: "button",
      text: { type: "plain_text", text: "➕ Attach to Quote" },
      action_id: "add_line_item_btn",
      style: "primary",
      value: quoteId,
    }],
  });

  return {
    type: "modal",
    callback_id: "quote_step_two_modal",
    private_metadata: quoteId,
    title: { type: "plain_text", text: "Quote Line Items" },
    submit: { type: "plain_text", text: "Finalize Quote" },
    blocks,
  };
}

export default SlackFunction(
  OpenDynamicModalDefinition,
  async ({ inputs, client }) => {
    const getResponse = await client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: inputs.schema_id,
    });
    const tenantConfig: any[] =
      (getResponse.ok && getResponse.item?.custom_fields)
        ? getResponse.item.custom_fields
        : [];

    const dynamicBlocks: any[] = [{
      type: "input",
      block_id: "product_name_block",
      element: { type: "plain_text_input", action_id: "name_input" },
      label: { type: "plain_text", text: "Record Name" },
    }];

    if (tenantConfig.length > 0) {
      tenantConfig.forEach((field, index) => {
        if (field.show_on_form === true) {
          dynamicBlocks.push({
            type: "input",
            block_id: `custom_field_${index}`,
            optional: field.required !== true,
            element: buildDynamicElement(field, `custom_action_${index}`),
            label: {
              type: "plain_text",
              text: field.name || `Field ${index + 1}`,
            },
          });
        }
      });
    }

    const modalTitle = inputs.schema_id === "schema_quote"
      ? "Create Quote (Step 1)"
      : "Create Product";
    const submitText = inputs.schema_id === "schema_quote"
      ? "Next: Add Products"
      : "Save Product";

    const viewResponse = await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: {
        type: "modal",
        callback_id: "dynamic_product_modal",
        private_metadata: inputs.schema_id,
        title: { type: "plain_text", text: modalTitle },
        submit: { type: "plain_text", text: submitText },
        blocks: dynamicBlocks,
      },
    });

    if (!viewResponse.ok) {return {
        error: "Failed to open modal: " + viewResponse.error,
      };}
    return { completed: false };
  },
)
  .addViewSubmissionHandler(
    ["dynamic_product_modal"],
    async ({ view, client }) => {
      const values = view.state.values;
      const isQuote = view.private_metadata === "schema_quote";
      const prefix = isQuote ? "Q-" : "P-";
      const targetDatastore = isQuote
        ? QuotesDatastore.name
        : ProductsDatastore.name;
      const queryResponse = await client.apps.datastore.query({
        datastore: targetDatastore,
      });
      let nextNumber = 1;
      if (queryResponse.ok && queryResponse.items) {nextNumber =
          queryResponse.items.length + 1;}

      const recordId = prefix + String(nextNumber).padStart(4, "0");
      const productName = values.product_name_block.name_input.value;
      const metadataBlob: Record<string, any> = {};

      for (const [blockId, actionObj] of Object.entries(values)) {
        if (blockId.startsWith("custom_field_")) {
          const aData = (actionObj as any)[Object.keys(actionObj as object)[0]];
          let typedVal = null;
          if (aData?.value) typedVal = aData.value;
          else if (aData?.selected_date) typedVal = aData.selected_date;
          else if (aData?.selected_time) typedVal = aData.selected_time;
          else if (aData?.selected_users) {
            typedVal = aData.selected_users.join(", ");
          } else if (aData?.selected_option) {
            typedVal = aData.selected_option.value;
          } else if (aData?.selected_options) {
            typedVal = aData.selected_options.map((o: any) => o.value).join(
              ", ",
            );
          }
          if (typedVal) metadataBlob[blockId] = typedVal;
        }
      }

      await client.apps.datastore.put({
        datastore: targetDatastore,
        item: {
          id: recordId,
          name: productName,
          description: "Dynamic record",
          metadata: JSON.stringify(metadataBlob),
          line_items: "[]",
        },
      });

      if (isQuote) {
        return {
          response_action: "update",
          view: await buildStepTwoView(client, recordId),
        };
      }
      return { response_action: "clear" };
    },
  )
  .addBlockActionsHandler(
    ["add_line_item_btn"],
    async ({ action, body, client }) => {
      const quoteId = action.value;
      const viewId = body.view?.id;
      const values = body.view?.state.values || {};
      const lineItemSchemaRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote_product",
      });
      const lineItemCustomFields: any[] =
        lineItemSchemaRes.item?.custom_fields || [];

      let selectedProductId = "none";
      let qty = "1";
      let unitPrice = "0";
      const capturedSpecsBlob: Record<string, any> = {};

      for (const [blockId, blockData] of Object.entries(values)) {
        if (blockId.startsWith("product_select_block_")) {
          selectedProductId =
            (blockData as any).product_select?.selected_option?.value || "none";
        }
        if (blockId.startsWith("qty_input_block_")) {qty =
            (blockData as any).qty_input?.value || "1";}

        // HARVEST MANUAL UNIT PRICE:
        if (blockId.startsWith("unit_price_input_block_")) {
          unitPrice = (blockData as any).unit_price_input?.value || "0";
        }

        if (blockId.startsWith("item_custom_")) {
          const fieldIdx = parseInt(blockId.split("_")[2], 10);
          const configuredLabel = lineItemCustomFields[fieldIdx]?.name ||
            "Spec " + (fieldIdx + 1);
          const aData = (blockData as any)[Object.keys(blockData as object)[0]];
          const extVal = aData?.value || aData?.selected_date ||
            aData?.selected_time ||
            (aData?.selected_option ? aData.selected_option.value : null);
          if (extVal) capturedSpecsBlob[configuredLabel] = extVal;
        }
      }

      if (selectedProductId !== "none" && viewId) {
        const prodRes = await client.apps.datastore.get({
          datastore: ProductsDatastore.name,
          id: selectedProductId,
        });
        const quoteRes = await client.apps.datastore.get({
          datastore: QuotesDatastore.name,
          id: quoteId,
        });
        if (quoteRes.ok && quoteRes.item) {
          const lineItems = JSON.parse(quoteRes.item.line_items || "[]");
          // Lock price into ledger:
          lineItems.push({
            productId: selectedProductId,
            productName: prodRes.item?.name || "Product",
            qty,
            unitPrice,
            customSpecs: capturedSpecsBlob,
          });
          quoteRes.item.line_items = JSON.stringify(lineItems);
          await client.apps.datastore.put({
            datastore: QuotesDatastore.name,
            item: quoteRes.item,
          });
        }
        await client.views.update({
          view_id: viewId,
          view: await buildStepTwoView(client, quoteId),
        });
      }
      return { completed: false };
    },
  )
  .addViewSubmissionHandler(
    ["quote_step_two_modal"],
    async ({ view, body, client }) => {
      const quoteId = view.private_metadata;
      const quoteRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: quoteId,
      });
      const quote = quoteRes.item;

      const lineItems = quote?.line_items ? JSON.parse(quote.line_items) : [];
      let calculatedTotal = 0;
      lineItems.forEach((item: any) => {
        const q = parseInt(item.qty) || 1;
        const p = parseFloat(item.unitPrice ?? 100) || 0;
        calculatedTotal += q * p;
      });

      await client.functions.completeSuccess({
        function_execution_id: body.function_data.execution_id,
        outputs: {
          quote_id: quoteId,
          customer_name: quote?.name || "Customer",
          total_amount: calculatedTotal > 0 ? calculatedTotal : 5000,
        },
      });

      return { response_action: "clear" };
    },
  );
