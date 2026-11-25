import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title: "SocialTask · 任务协作与客户管理",description: "内容发布、任务工单、企业微信通知、客户跟进统一工作台"};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
