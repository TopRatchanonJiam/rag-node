import type { Metadata } from "next";
import AdminLayout from "../admin/layout";

// หน้าจัดการคลังความรู้อยู่ที่ /kb (ไม่ใช่ /admin/knowledge) แต่ใช้โครงหลังบ้านเดียวกัน
export const metadata: Metadata = { title: "คลังความรู้ — AI Assistant" };

export default AdminLayout;
