/**
 * Browser-safe subset of @mailory/core: pure logic with no Node built-ins. Client components import
 * from "@mailory/core/shared"; the main entry also exports password/token code that needs node:crypto.
 * shared.test.ts guards this boundary.
 */
export * from "./authz";
export * from "./slug";
export * from "./csv";
export * from "./email";
export * from "./segment-fields";
export * from "./custom-fields";
export * from "./import-mapping";
export * from "./email-doc";
export * from "./brand";
export * from "./image-sniff";
export * from "./email-markup";
export * from "./domain";
export * from "./campaign";
export * from "./deliverability";
export * from "./automation";
export * from "./entitlements";
export * from "./webhook";
