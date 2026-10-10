"use client";
import { useEffect } from "react";

/** 在飞书客户端内打开时自动走飞书授权（免登）；浏览器里则显示按钮让用户点。 */
export function FeishuAutoLogin({ href }: { href: string }) {
  useEffect(() => {
    if (/Lark|Feishu/i.test(navigator.userAgent)) location.replace(href);
  }, [href]);
  return null;
}
