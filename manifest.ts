import { Manifest } from "deno-slack-sdk/mod.ts";
import { AddProductWorkflow } from "./workflows/add_product_workflow.ts";
import { ManageSettingsWorkflow } from "./workflows/manage_settings_workflow.ts";
import { CreateQuoteWorkflow } from "./workflows/create_quote_workflow.ts";

// 🎯 Claim the two new domains
import { ProductControllerDefinition } from "./functions/product_controller.ts";
import { QuoteControllerDefinition } from "./functions/quote_controller.ts";

import { TenantSettingsDatastore } from "./datastores/tenant_settings.ts";
import { ProductsDatastore } from "./datastores/products.ts";
import { QuotesDatastore } from "./datastores/quotes.ts";

export default Manifest({
  name: "Spere",
  description: "A dynamic true CRM built for Slack.",
  icon: "assets/spere-logo.png",
  workflows: [
    AddProductWorkflow,
    ManageSettingsWorkflow,
    CreateQuoteWorkflow,
  ],
  functions: [
    ProductControllerDefinition,
    QuoteControllerDefinition,
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