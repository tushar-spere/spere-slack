import { Manifest } from "deno-slack-sdk/mod.ts";
import { AddProductWorkflow } from "./workflows/add_product_workflow.ts";
import { ManageSettingsWorkflow } from "./workflows/manage_settings_workflow.ts";
import { CreateQuoteWorkflow } from "./workflows/create_quote_workflow.ts";
import { CreateAccountWorkflow } from "./workflows/create_account_workflow.ts";
import { Customer360Workflow } from "./workflows/customer_360_workflow.ts"; // 🎯 PHASE 3: ADDED

// 🎯 Claim the domains
import { ProductControllerDefinition } from "./functions/product_controller.ts";
import { QuoteControllerDefinition } from "./functions/quote_controller.ts";
import { AccountControllerDefinition } from "./functions/account_controller.ts";
import { Customer360ControllerDefinition } from "./functions/customer_360_controller.ts"; // 🎯 PHASE 3: ADDED

import { TenantSettingsDatastore } from "./datastores/tenant_settings.ts";
import { ProductsDatastore } from "./datastores/products.ts";
import { QuotesDatastore } from "./datastores/quotes.ts";
import { AccountsDatastore } from "./datastores/accounts.ts";

export default Manifest({
  name: "Spere",
  description: "A dynamic true CRM built for Slack.",
  icon: "assets/spere-logo.png",
  workflows: [
    AddProductWorkflow,
    ManageSettingsWorkflow,
    CreateQuoteWorkflow,
    CreateAccountWorkflow,
    Customer360Workflow, // 🎯 PHASE 3: REGISTERED
  ],
  functions: [
    ProductControllerDefinition,
    QuoteControllerDefinition,
    AccountControllerDefinition,
    Customer360ControllerDefinition, // 🎯 PHASE 3: REGISTERED
  ],
  outgoingDomains: [],
  datastores: [
    TenantSettingsDatastore,
    ProductsDatastore,
    QuotesDatastore,
    AccountsDatastore,
  ],
  botScopes: [
    "commands",
    "chat:write",
    "chat:write.public",
    "datastore:read",
    "datastore:write",
  ],
});
