"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormRow, Input, Select, Textarea } from "@/components/ui/form";
import { ErrorState, Note } from "@/components/ui/states";
import { api } from "@/lib/client/api";
import type { Category } from "./types";

const empty = {
  platform: "shopee",
  externalProductId: "",
  shopName: "",
  title: "",
  brand: "",
  description: "",
  categoryId: "",
  price: "",
  commissionRate: "",
  capAmount: "",
  commissionIsEstimated: false,
  productUrl: "",
  affiliateUrl: "",
  imageUrl: "",
  imageRights: "unknown",
};

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function ManualAddDialog({ categories, onCreated }: { categories: Category[]; onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState(empty);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ status: string; possibleDuplicateOf?: string }>("/api/products", {
        method: "POST",
        body: {
          platform: f.platform,
          externalProductId: f.externalProductId,
          shopName: f.shopName || null,
          title: f.title,
          brand: f.brand || null,
          description: f.description || null,
          categoryId: f.categoryId || null,
          price: Number(f.price),
          commissionRate: numOrNull(f.commissionRate),
          capAmount: numOrNull(f.capAmount),
          commissionIsEstimated: f.commissionIsEstimated,
          productUrl: f.productUrl || null,
          affiliateUrl: f.affiliateUrl || null,
          imageUrl: f.imageUrl || null,
          imageRights: f.imageRights,
        },
      });
      toast.success(
        r.status === "updated" ? "อัปเดตสินค้าเดิม (รหัสซ้ำในร้านเดียวกัน)" : r.status === "merged" ? "รวมเข้ากับสินค้าเดิม (GTIN/รุ่นตรงกัน)" : "เพิ่มสินค้าแล้ว",
      );
      if (r.possibleDuplicateOf) toast.warning("พบสินค้าที่อาจซ้ำกัน — ตรวจสอบได้ที่ตัวกรอง 'อาจซ้ำ'");
      setF(empty);
      setOpen(false);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus /> เพิ่มสินค้าเอง
        </Button>
      </DialogTrigger>
      <DialogContent title="เพิ่มสินค้าด้วยตนเอง" description="ข้อมูลที่กรอกจะถูกบันทึกเป็นแหล่งที่มา MANUAL" wide>
        <form onSubmit={submit}>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormRow label="แพลตฟอร์ม *" htmlFor="m-platform">
              <Select id="m-platform" value={f.platform} onChange={set("platform")}>
                <option value="shopee">Shopee</option>
                <option value="lazada">Lazada</option>
              </Select>
            </FormRow>
            <FormRow label="รหัสสินค้า (Item ID) *" htmlFor="m-id">
              <Input id="m-id" required value={f.externalProductId} onChange={set("externalProductId")} />
            </FormRow>
            <FormRow label="ชื่อสินค้า *" htmlFor="m-title" className="sm:col-span-2">
              <Input id="m-title" required minLength={2} value={f.title} onChange={set("title")} />
            </FormRow>
            <FormRow label="ชื่อร้าน" htmlFor="m-shop">
              <Input id="m-shop" value={f.shopName} onChange={set("shopName")} />
            </FormRow>
            <FormRow label="แบรนด์" htmlFor="m-brand">
              <Input id="m-brand" value={f.brand} onChange={set("brand")} />
            </FormRow>
            <FormRow label="หมวดหมู่ (ว่าง = จัดอัตโนมัติ)" htmlFor="m-cat">
              <Select id="m-cat" value={f.categoryId} onChange={set("categoryId")}>
                <option value="">จัดหมวดหมู่อัตโนมัติ</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormRow>
            <FormRow label="ราคา (บาท) *" htmlFor="m-price">
              <Input id="m-price" type="number" min={0} step="0.01" required value={f.price} onChange={set("price")} />
            </FormRow>
            <FormRow label="ค่าคอม %" htmlFor="m-rate" hint="เว้นว่างถ้ายังไม่ทราบ — ระบบจะไม่เดาค่า">
              <Input id="m-rate" type="number" min={0} max={100} step="0.01" value={f.commissionRate} onChange={set("commissionRate")} />
            </FormRow>
            <FormRow label="เพดานค่าคอมต่อออเดอร์ (บาท)" htmlFor="m-cap">
              <Input id="m-cap" type="number" min={0} step="0.01" value={f.capAmount} onChange={set("capAmount")} />
            </FormRow>
            <label className="mb-4 flex items-center gap-2 text-xs sm:col-span-2">
              <input type="checkbox" checked={f.commissionIsEstimated} onChange={set("commissionIsEstimated")} />
              อัตรานี้เป็นค่าประมาณ (ไม่ได้มาจากหน้า Affiliate อย่างเป็นทางการ)
            </label>
            <FormRow label="ลิงก์สินค้า" htmlFor="m-url">
              <Input id="m-url" type="url" placeholder="https://" value={f.productUrl} onChange={set("productUrl")} />
            </FormRow>
            <FormRow label="ลิงก์ Affiliate" htmlFor="m-aff">
              <Input id="m-aff" type="url" placeholder="https://" value={f.affiliateUrl} onChange={set("affiliateUrl")} />
            </FormRow>
            <FormRow label="ลิงก์รูปภาพ" htmlFor="m-img">
              <Input id="m-img" type="url" placeholder="https://" value={f.imageUrl} onChange={set("imageUrl")} />
            </FormRow>
            <FormRow label="สิทธิ์การใช้ภาพในวิดีโอ" htmlFor="m-rights">
              <Select id="m-rights" value={f.imageRights} onChange={set("imageRights")}>
                <option value="unknown">ยังไม่ยืนยันสิทธิ์</option>
                <option value="authorized">ได้รับอนุญาตให้ใช้ภาพ</option>
                <option value="not_allowed">ห้ามใช้ภาพ</option>
              </Select>
            </FormRow>
            <FormRow label="รายละเอียดสินค้า (ใช้เป็นข้อเท็จจริงในสคริปต์)" htmlFor="m-desc" className="sm:col-span-2">
              <Textarea id="m-desc" value={f.description} onChange={set("description")} />
            </FormRow>
          </div>
          <Note className="mb-4">ระบบจะไม่เติมยอดขาย คะแนนรีวิว หรือค่าคอมให้เอง — ข้อมูลที่ขาดจะลดความเชื่อมั่นของคะแนน</Note>
          {error && <ErrorState error={error} className="mb-4" />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              บันทึกสินค้า
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
