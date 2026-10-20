import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Prisma CLI commands that only validate or generate do not require a database URL.
    url: process.env.DATABASE_URL,
  },
});