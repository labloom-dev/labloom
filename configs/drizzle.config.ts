import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "sqlite",
    schema: "./main/storage/tables.ts",
    out: "./main/storage/migrations/generated",
    breakpoints: true
});