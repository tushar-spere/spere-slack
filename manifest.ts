import { Manifest } from "deno-slack-sdk/mod.ts";

/**
 * The app manifest contains the app's configuration. This
 * file defines attributes like app name and description.
 * https://api.slack.com/automation/manifest
 */
export default Manifest({
  name: "spere-slack",
  description: "Enterprise Slack application tailored to our business needs",
  icon: "assets/default_new_app_icon.png",
  workflows: [],
  outgoingDomains: [],
  datastores: [],
  botScopes: [
    // We are starting with an empty array.
    // We will explicitly add permissions (like "chat:write") ONLY when our business logic demands it.
  ],
});
