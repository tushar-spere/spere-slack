import { Manifest } from "deno-slack-sdk/mod.ts";
import { AddProductWorkflow } from "./workflows/add_product_workflow.ts";
import { ListProductsWorkflow } from "./workflows/list_products_workflow.ts";
import { ManageSettingsWorkflow } from "./workflows/manage_settings_workflow.ts";
import { CreateQuoteWorkflow } from "./workflows/create_quote_workflow.ts";
import { ListQuotesWorkflow } from "./workflows/list_quotes_workflow.ts";

import { TenantSettingsDatastore } from "./datastores/tenant_settings.ts";
import { ProductsDatastore } from "./datastores/products.ts";
import { QuotesDatastore } from "./datastores/quotes.ts";

export default Manifest({
  name: "Spere",
  description: "A dynamic true CRM built for Slack.",
  icon: "assets/spere-logo.png",
  workflows: [
    AddProductWorkflow,
    ListProductsWorkflow,
    ManageSettingsWorkflow,
    CreateQuoteWorkflow,
    ListQuotesWorkflow,
  ],
  outgoingDomains: [],
  datastores: [
    TenantSettingsDatastore,
    ProductsDatastore,
    QuotesDatastore,
  ],
  botScopes: [
    "commands",
    "chat:write",
    "chat:write.public",
    "datastore:read",
    "datastore:write",
  ],
});
