import { Manifest } from "deno-slack-sdk/mod.ts";
import { ProductsDatastore } from "./datastores/products.ts";
import { QuotesDatastore } from "./datastores/quotes.ts";
import { AddProductWorkflow } from "./workflows/add_product_workflow.ts";

export default Manifest({
  name: "spere-slack",
  description: "Enterprise Slack application tailored to our business needs",
  icon: "assets/default_new_app_icon.png",
  workflows: [AddProductWorkflow],
  outgoingDomains: [],
  datastores: [ProductsDatastore, QuotesDatastore],
  botScopes: [
    "datastore:read",
    "datastore:write",
    "chat:write",
    "chat:write.public", // The missing permission
  ],
});
