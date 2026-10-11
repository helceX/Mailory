import { ConsoleTransport, SesTransport, type EmailTransport } from "@mailory/email";

export function createEmailTransport(config: {
  EMAIL_PROVIDER: "console" | "ses";
  AWS_REGION?: string;
  SES_CONFIGURATION_SET?: string;
}): EmailTransport {
  if (config.EMAIL_PROVIDER === "ses") {
    if (!config.AWS_REGION) throw new Error("AWS_REGION is required for SES");
    return new SesTransport({
      region: config.AWS_REGION,
      configurationSet: config.SES_CONFIGURATION_SET,
    });
  }
  return new ConsoleTransport();
}
