import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "知政公考｜智能备考平台",
    short_name: "知政公考",
    description: "专项练习、模拟考试、申论训练与智能学习规划",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#172554",
    orientation: "any",
    lang: "zh-CN",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon", purpose: "any" }],
  };
}
