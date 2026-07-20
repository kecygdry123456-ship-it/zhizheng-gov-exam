import type { Metadata } from "next";
import { AdminPortal } from "@/components/app/admin-portal";

export const metadata: Metadata = {
  title: "管理后台｜知政公考",
};

export default function AdminPage() {
  return <AdminPortal />;
}
