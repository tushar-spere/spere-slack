import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { ProductsDatastore } from "../datastores/products.ts";

/**
 * 1. THE DEFINITION
 * This is our TypeScript boundary. It dictates exactly what data this function
 * accepts and what it promises to return. No exceptions.
 */
export const CreateProductFunctionDefinition = DefineFunction({
  callback_id: "create_product_function",
  title: "Create Product",
  description: "Takes validated input and saves a new product to the Datastore",
  source_file: "functions/create_product.ts",
  input_parameters: {
    properties: {
      id: { type: Schema.types.string, description: "Unique Product ID" },
      name: { type: Schema.types.string, description: "Name of the product" },
      description: {
        type: Schema.types.string,
        description: "Product description",
      },
    },
    required: ["id", "name", "description"],
  },
  output_parameters: {
    properties: {
      id: {
        type: Schema.types.string,
        description: "The ID of the saved product",
      },
    },
    required: ["id"],
  },
});

/**
 * 2. THE HANDLER
 * This is the stateless execution. It takes the inputs defined above,
 * performs the exact database operation, and returns the output.
 */
export default SlackFunction(
  CreateProductFunctionDefinition,
  async ({ inputs, client }) => {
    // We extract the exact inputs guaranteed by our Definition
    const { id, name, description } = inputs;

    // We use the Slack client to interact with our Datastore
    const putResponse = await client.apps.datastore.put({
      datastore: ProductsDatastore.name,
      item: {
        id,
        name,
        description,
      },
    });

    // Architecture Law: Always handle external failure gracefully
    if (!putResponse.ok) {
      return {
        error: `Failed to save product to database: ${putResponse.error}`,
      };
    }

    // Return the strict output defined in our Definition
    return { outputs: { id } };
  },
);
