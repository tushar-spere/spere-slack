import { Manifest } from "deno-slack-sdk/mod.ts";
import { ProductsDatastore } from "./datastores/products.ts";
import { QuotesDatastore } from "./datastores/quotes.ts";
import { TenantSettingsDatastore } from "./datastores/tenant_settings.ts";
import { AddProductWorkflow } from "./workflows/add_product_workflow.ts";
import { ListProductsWorkflow } from "./workflows/list_products_workflow.ts";
import { ManageSettingsWorkflow } from "./workflows/manage_settings_workflow.ts";

export default Manifest({
  name: "spere-slack",
  description: "Enterprise Slack application tailored to our business needs",
  icon: "assets/default_new_app_icon.png",
  workflows: [
    AddProductWorkflow,
    ListProductsWorkflow,
    ManageSettingsWorkflow,
  ],
  outgoingDomains: [],
  datastores: [
    ProductsDatastore,
    QuotesDatastore,
    TenantSettingsDatastore,
  ],
  botScopes: [
    "datastore:read",
    "datastore:write",
    "chat:write",
    "chat:write.public",
  ],
});
