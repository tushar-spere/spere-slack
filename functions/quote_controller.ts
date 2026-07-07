import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { ProductsDatastore } from "../datastores/products.ts";
import { QuotesDatastore } from "../datastores/quotes.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";
import { AccountsDatastore } from "../datastores/accounts.ts";

export const QuoteControllerDefinition = DefineFunction({
  callback_id: "quote_controller",
  title: "Quote Generation Controller",
  description: "Handles creating dynamic quotes and line items",
  source_file: "functions/quote_controller.ts",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
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

function buildDynamicElement(field: any, actionId: string, initVal?: any) {
  const safeStr = initVal !== undefined && initVal !== null
    ? String(initVal)
    : undefined;
  switch (field.type) {
    case "plain_text_input_multi":
      return {
        type: "plain_text_input",
        action_id: actionId,
        multiline: true,
        initial_value: safeStr,
      };
    case "datepicker":
      return { type: "datepicker", action_id: actionId, initial_date: safeStr };
    case "timepicker":
      return { type: "timepicker", action_id: actionId, initial_time: safeStr };
    case "multi_users_select":
      return { type: "multi_users_select", action_id: actionId };
    case "checkboxes": {
      const rawOpts = field.dropdown_options?.length > 0
        ? field.dropdown_options
        : ["No Options"];
      const blockOpts = rawOpts.map((opt: string) => ({
        text: { type: "plain_text", text: String(opt).substring(0, 75) },
        value: String(opt).substring(0, 75),
      }));
      const resObj: any = {
        type: "checkboxes",
        action_id: actionId,
        options: blockOpts,
      };
      if (safeStr) {
        const initOpts = blockOpts.filter((bOpt) =>
          safeStr.split(",").map((s) => s.trim()).includes(bOpt.value)
        );
        if (initOpts.length > 0) resObj.initial_options = initOpts;
      }
      return resObj;
    }
    case "static_select":
    case "multi_static_select": {
      const rawOpts = field.dropdown_options?.length > 0
        ? field.dropdown_options
        : ["No Options"];
      const blockOpts = rawOpts.map((opt: string) => ({
        text: { type: "plain_text", text: String(opt).substring(0, 75) },
        value: String(opt).substring(0, 75),
      }));
      if (field.type === "static_select") {
        return {
          type: "static_select",
          action_id: actionId,
          placeholder: { type: "plain_text", text: "Select..." },
          options: blockOpts,
          initial_option: safeStr
            ? blockOpts.find((o) => o.value === safeStr)
            : undefined,
        };
      } else {
        const mObj: any = {
          type: "multi_static_select",
          action_id: actionId,
          placeholder: { type: "plain_text", text: "Select..." },
          options: blockOpts,
        };
        if (safeStr) {
          const initOpts = blockOpts.filter((bOpt) =>
            safeStr.split(",").map((s) => s.trim()).includes(bOpt.value)
          );
          if (initOpts.length > 0) mObj.initial_options = initOpts;
        }
        return mObj;
      }
    }
    case "plain_text_input":
    default:
      return {
        type: "plain_text_input",
        action_id: actionId,
        initial_value: safeStr,
      };
  }
}

async function buildStepTwoView(
  client: any,
  quoteId: string,
  pickedCatalogSku?: string,
) {
  const refreshId = Math.floor(Math.random() * 1_000_000);
  const [quoteRes, prodRes, schemaRes] = await Promise.all([
    client.apps.datastore.get({ datastore: QuotesDatastore.name, id: quoteId }),
    client.apps.datastore.query({
      datastore: ProductsDatastore.name,
      expression: "#active = :trueVal",
      expression_attributes: { "#active": "is_active" },
      expression_values: { ":trueVal": true },
    }),
    client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "schema_quote_product",
    }),
  ]);

  const quote = quoteRes.item;
  const lineItems = quote?.line_items ? JSON.parse(quote.line_items) : [];
  const products = prodRes.items || [];
  const productOptions = products.slice(0, 100).map((p: any) => ({
    text: { type: "plain_text", text: String(p.name).substring(0, 75) },
    value: String(p.id),
  }));
  if (productOptions.length === 0) {
    productOptions.push({
      text: { type: "plain_text", text: "No active products!" },
      value: "none",
    });
  }

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
    lineItems.forEach((item: any, idx: number) => {
      let specPreview = "";
      if (item.customSpecs && Object.keys(item.customSpecs).length > 0) {
        specPreview = "\n   \u21b3 " +
          Object.entries(item.customSpecs).map(([k, v]) => "*" + k + ":* " + v)
            .join(" | ");
      }
      const uPrice = parseFloat(item.unitPrice) || 0;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*" + (idx + 1) + ". " + item.productName + "* | _Qty:_ " +
            item.qty + " (@ $" + uPrice.toLocaleString() + ") - *$" +
            ((parseInt(item.qty, 10) || 1) * uPrice).toLocaleString() + "*" +
            specPreview,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Remove" },
          style: "danger",
          action_id: "remove_line_item_action",
          value: JSON.stringify({ index: idx }),
        },
      });
    });
  }

  const pickedProdObj = pickedCatalogSku
    ? products.find((p: any) => p.id === pickedCatalogSku)
    : undefined;
  const initCatalogSelect = pickedProdObj
    ? productOptions.find((o: any) => o.value === pickedCatalogSku)
    : undefined;
  const autoPriceStr = pickedProdObj?.price ? String(pickedProdObj.price) : "";

  blocks.push(
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: "*Attach a Product*" } },
    {
      type: "input",
      block_id: `product_select_block_${refreshId}`,
      optional: true,
      element: {
        type: "static_select",
        action_id: "catalog_select",
        placeholder: { type: "plain_text", text: "Select a Product..." },
        options: productOptions,
        initial_option: initCatalogSelect,
      },
      label: { type: "plain_text", text: "Product Catalog" },
    },
    {
      type: "input",
      block_id: `qty_input_block_${refreshId}`,
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "qty_val",
        initial_value: "1",
      },
      label: { type: "plain_text", text: "Quantity" },
    },
    {
      type: "input",
      block_id: `unit_price_input_block_${refreshId}`,
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "price_val",
        initial_value: autoPriceStr || undefined,
        placeholder: { type: "plain_text", text: "0.00" },
      },
      label: { type: "plain_text", text: "Unit Price ($)" },
    },
  );

  (schemaRes.item?.custom_fields || []).forEach(
    (fieldBlob: any, idx: number) => {
      if (fieldBlob.show_on_form) {
        blocks.push({
          type: "input",
          block_id: `item_custom_${idx}_${refreshId}`,
          optional: true,
          element: buildDynamicElement(fieldBlob, `item_act_${idx}`),
          label: {
            type: "plain_text",
            text: fieldBlob.name || `Spec ${idx + 1}`,
          },
        });
      }
    },
  );

  blocks.push({
    type: "actions",
    block_id: `add_item_actions_${refreshId}`,
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Back" },
        action_id: "back_to_step_one_btn",
        value: quoteId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Attach to Quote" },
        action_id: "add_line_item_btn",
        style: "primary",
        value: quoteId,
      },
    ],
  });

  return {
    type: "modal",
    callback_id: "quote_step_two_modal",
    private_metadata: quoteId,
    title: { type: "plain_text", text: "Quote Line Items" },
    submit: { type: "plain_text", text: "Save" },
    blocks,
  };
}

export default SlackFunction(
  QuoteControllerDefinition,
  async ({ inputs, client }) => {
    const [getRes, accRes] = await Promise.all([
      client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote",
      }),
      client.apps.datastore.query({ datastore: AccountsDatastore.name }),
    ]);

    const tenantConfig: any[] = getRes.item?.custom_fields || [];
    const accounts = accRes.items || [];
    const blocks: any[] = [];

    if (accounts.length === 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "⚠️ _You have no Accounts created yet. Please run the 'Create an Account' workflow before building a Quote._",
        },
      });
      blocks.push({
        type: "input",
        block_id: "quote_account_block",
        element: {
          type: "plain_text_input",
          action_id: "account_select",
          initial_value: "NO_ACCOUNT",
        },
        label: { type: "plain_text", text: "System Error Override" },
      });
    } else {
      const accOptions = accounts.slice(0, 100).map((a: any) => ({
        text: { type: "plain_text", text: String(a.name).substring(0, 75) },
        value: String(a.id),
      }));
      blocks.push({
        type: "input",
        block_id: "quote_account_block",
        optional: false,
        element: {
          type: "static_select",
          action_id: "account_select",
          placeholder: {
            type: "plain_text",
            text: "Select Customer Account...",
          },
          options: accOptions,
        },
        label: { type: "plain_text", text: "Target Account *" },
      });
    }

    blocks.push({
      type: "input",
      block_id: "quote_name_block",
      element: {
        type: "plain_text_input",
        action_id: "name_input",
        placeholder: { type: "plain_text", text: "e.g., Q3 Expansion" },
      },
      label: { type: "plain_text", text: "Quote Name *" },
    });

    tenantConfig.forEach((field, index) => {
      if (field.show_on_form) {
        blocks.push({
          type: "input",
          block_id: `custom_field_${index}`,
          optional: !field.required,
          element: buildDynamicElement(field, `custom_action_${index}`),
          label: {
            type: "plain_text",
            text: field.name + (field.required ? " *" : ""),
          },
        });
      }
    });

    await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: {
        type: "modal",
        callback_id: "quote_step_one_modal",
        title: { type: "plain_text", text: "Create Quote (1/2)" },
        submit: { type: "plain_text", text: "Next" },
        blocks,
      },
    });
    return { completed: false };
  },
)
  .addViewSubmissionHandler(
    ["quote_step_one_modal"],
    async ({ view, client }) => {
      const vals = view.state.values;
      const accountId =
        vals.quote_account_block?.account_select?.selected_option?.value ||
        "UNKNOWN_ACCOUNT";
      const quoteName = vals.quote_name_block?.name_input?.value ||
        "Draft Quote";

      const metadataBlob: Record<string, any> = {};
      for (const [blockId, actionObj] of Object.entries(vals)) {
        if (blockId.startsWith("custom_field_")) {
          const aData = (actionObj as any)[Object.keys(actionObj as object)[0]];
          const val = aData?.value ?? aData?.selected_date ??
            aData?.selected_time ?? aData?.selected_option?.value ??
            aData?.selected_options?.map((o: any) => o.value).join(", ");
          if (val) metadataBlob[blockId] = val;
        }
      }

      const queryRes = await client.apps.datastore.query({
        datastore: QuotesDatastore.name,
      });
      const nextNum = (queryRes.items?.length || 0) + 1;
      const recordId = "Q-" + String(nextNum).padStart(4, "0");

      let existingItems = "[]";
      let birthTs = Math.floor(Date.now() / 1000);

      if (view.private_metadata) {
        const qRes = await client.apps.datastore.get({
          datastore: QuotesDatastore.name,
          id: view.private_metadata,
        });
        if (qRes.item?.line_items) existingItems = qRes.item.line_items;
        if (qRes.item?.metadata) {
          try {
            const oldMeta = JSON.parse(qRes.item.metadata);
            if (oldMeta._sys_created_at) birthTs = oldMeta._sys_created_at; // 🎯 Preserve original birth date
          } catch (e) { /**/ }
        }
      }

      // 🎯 STAMP TIMESTAMPS AT BIRTH
      metadataBlob["_sys_created_at"] = birthTs;
      metadataBlob["_sys_updated_at"] = Math.floor(Date.now() / 1000);

      await client.apps.datastore.put({
        datastore: QuotesDatastore.name,
        item: {
          id: recordId,
          name: quoteName,
          description: accountId,
          metadata: JSON.stringify(metadataBlob),
          line_items: existingItems,
        },
      });

      return {
        response_action: "update",
        view: await buildStepTwoView(client, recordId),
      };
    },
  )
  .addBlockActionsHandler(
    ["catalog_select"],
    async ({ action, body, client }) => {
      const pickedId = (action as any).selected_option?.value || undefined;
      if (body.view?.private_metadata) {
        await client.views.update({
          view_id: body.view.id,
          view: await buildStepTwoView(
            client,
            body.view.private_metadata,
            pickedId,
          ),
        });
      }
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["remove_line_item_action"],
    async ({ action, body, client }) => {
      const p = JSON.parse(action.value);
      const qId = body.view?.private_metadata;
      if (qId && body.view?.id) {
        const qRes = await client.apps.datastore.get({
          datastore: QuotesDatastore.name,
          id: qId,
        });
        if (qRes.item) {
          const items = JSON.parse(qRes.item.line_items || "[]");
          items.splice(p.index, 1);
          qRes.item.line_items = JSON.stringify(items);
          await client.apps.datastore.put({
            datastore: QuotesDatastore.name,
            item: qRes.item,
          });
          await client.views.update({
            view_id: body.view.id,
            view: await buildStepTwoView(client, qId),
          });
        }
      }
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["add_line_item_btn"],
    async ({ action, body, client }) => {
      const qId = action.value;
      const vals = body.view?.state.values || {};
      let selProd = "none", qty = "1", price = "0";
      const specs: Record<string, any> = {};

      const sRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote_product",
      });
      const cFields = sRes.item?.custom_fields || [];

      for (const [bId, aObj] of Object.entries(vals)) {
        if (bId.startsWith("product_select_block_")) {
          selProd = (aObj as any).catalog_select?.selected_option?.value ||
            "none";
        }
        if (bId.startsWith("qty_input_block_")) {
          qty = (aObj as any).qty_val?.value || "1";
        }
        if (bId.startsWith("unit_price_input_block_")) {
          price = (aObj as any).price_val?.value || "0";
        }
        if (bId.startsWith("item_custom_")) {
          const fIdx = parseInt(bId.split("_")[2], 10);
          const aData = (aObj as any)[Object.keys(aObj as object)[0]];
          const val = aData?.value ?? aData?.selected_date ??
            aData?.selected_time ?? aData?.selected_option?.value ??
            aData?.selected_options?.map((o: any) => o.value).join(", ");
          if (val) specs[cFields[fIdx]?.name || "Spec"] = val;
        }
      }

      if (selProd !== "none" && body.view?.id) {
        const [pRes, qRes] = await Promise.all([
          client.apps.datastore.get({
            datastore: ProductsDatastore.name,
            id: selProd,
          }),
          client.apps.datastore.get({
            datastore: QuotesDatastore.name,
            id: qId,
          }),
        ]);
        if (qRes.item) {
          const items = JSON.parse(qRes.item.line_items || "[]");
          items.push({
            productId: selProd,
            productName: pRes.item?.name || "Product",
            qty,
            unitPrice: price,
            customSpecs: specs,
          });
          qRes.item.line_items = JSON.stringify(items);
          await client.apps.datastore.put({
            datastore: QuotesDatastore.name,
            item: qRes.item,
          });
          await client.views.update({
            view_id: body.view.id,
            view: await buildStepTwoView(client, qId),
          });
        }
      }
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["back_to_step_one_btn"],
    async ({ action, body, client }) => {
      const qId = action.value;
      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: qId,
      });
      const qBlob = qRes.item?.metadata ? JSON.parse(qRes.item.metadata) : {};

      const [sRes, accRes] = await Promise.all([
        client.apps.datastore.get({
          datastore: TenantSettingsDatastore.name,
          id: "schema_quote",
        }),
        client.apps.datastore.query({ datastore: AccountsDatastore.name }),
      ]);

      const accounts = accRes.items || [];
      const accOptions = accounts.slice(0, 100).map((a: any) => ({
        text: { type: "plain_text", text: String(a.name).substring(0, 75) },
        value: String(a.id),
      }));
      const initAccSelect = qRes.item?.description
        ? accOptions.find((o: any) => o.value === qRes.item.description)
        : undefined;

      const blocks: any[] = [
        {
          type: "input",
          block_id: "quote_account_block",
          optional: false,
          element: {
            type: "static_select",
            action_id: "account_select",
            placeholder: {
              type: "plain_text",
              text: "Select Customer Account...",
            },
            options: accOptions,
            initial_option: initAccSelect,
          },
          label: { type: "plain_text", text: "Target Account *" },
        },
        {
          type: "input",
          block_id: "quote_name_block",
          element: {
            type: "plain_text_input",
            action_id: "name_input",
            initial_value: qRes.item?.name || "",
          },
          label: { type: "plain_text", text: "Quote Name *" },
        },
      ];

      (sRes.item?.custom_fields || []).forEach((field: any, index: number) => {
        if (field.show_on_form) {
          blocks.push({
            type: "input",
            block_id: `custom_field_${index}`,
            optional: !field.required,
            element: buildDynamicElement(
              field,
              `custom_action_${index}`,
              qBlob[`custom_field_${index}`],
            ),
            label: {
              type: "plain_text",
              text: field.name + (field.required ? " *" : ""),
            },
          });
        }
      });

      if (body.view?.id) {
        await client.views.update({
          view_id: body.view.id,
          view: {
            type: "modal",
            callback_id: "quote_step_one_modal",
            private_metadata: qId,
            title: { type: "plain_text", text: "Create Quote (1/2)" },
            submit: { type: "plain_text", text: "Next" },
            blocks,
          },
        });
      }
      return { completed: false };
    },
  )
  .addViewSubmissionHandler(
    ["quote_step_two_modal"],
    async ({ view, body, client }) => {
      const qId = view.private_metadata;
      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: qId,
      });
      let calcTot = 0;
      (qRes.item?.line_items ? JSON.parse(qRes.item.line_items) : []).forEach((
        i: any,
      ) =>
        calcTot += (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0)
      );

      await client.functions.completeSuccess({
        function_execution_id: body.function_data.execution_id,
        outputs: {
          quote_id: qId,
          customer_name: qRes.item?.description || "UNKNOWN_ACCOUNT",
          total_amount: calcTot,
        },
      });
      return { response_action: "clear" };
    },
  );
