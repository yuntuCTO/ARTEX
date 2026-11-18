import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "云途Agent",
  version: packageJson.version,
  copyright: `© ${currentYear}, 云途Agent.`,
  meta: {
    title: "云途Agent — 自主渗透测试控制台",
    description: "LLM 驱动的自主渗透测试系统控制台",
  },
};
