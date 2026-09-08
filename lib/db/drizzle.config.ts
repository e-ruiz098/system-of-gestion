import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/*.ts",
  dialect: "turso",
  dbCredentials: {
    url: "file:./data/local.db",
  },
});