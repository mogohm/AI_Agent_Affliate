import type { TemplateConfig } from "@/db/schema";

export type TemplateStyle = "showcase" | "review" | "problem_solution" | "promo" | "three_benefits" | "comparison";

export type DefaultTemplate = {
  key: string;
  name: string;
  style: TemplateStyle;
  description: string;
  prompt: string;
  config: TemplateConfig;
};

/** Shared rules injected into every script prompt — truthfulness & compliance. */
export const TRUTHFULNESS_RULES = [
  "ใช้เฉพาะข้อเท็จจริงที่อยู่ใน PRODUCT_FACTS เท่านั้น ห้ามเดาสเปก วัสดุ ผลลัพธ์ หรือรางวัล",
  "ห้ามเขียนรีวิวแบบประสบการณ์ส่วนตัว (เช่น 'ฉันใช้มาแล้ว') เว้นแต่ข้อมูลระบุว่าเป็นรีวิวจริงที่ได้รับอนุญาต",
  "ห้ามอ้างผลลัพธ์ก่อน/หลัง ผลทางการแพทย์ หรือการันตีผลลัพธ์",
  "ห้ามระบุราคาตายตัวในบทพูด ให้ชวนดูราคาปัจจุบันที่ลิงก์ เพราะราคาเปลี่ยนแปลงได้",
  "ทุก claim ต้องอ้างอิงชื่อฟิลด์ต้นทางใน claims[].sourceField",
  "ต้องมีข้อความเปิดเผยว่าเป็นลิงก์ Affiliate/โฆษณา",
];

const palette = (from: string, to: string, accent: string) => ({ from, to, accent });

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "product-showcase",
    name: "Product Showcase",
    style: "showcase",
    description: "เปิดด้วยภาพสินค้า เน้นจุดเด่นที่ยืนยันได้ ปิดด้วย CTA",
    prompt: "สร้างวิดีโอโชว์สินค้าแนวตั้ง โทนพรีเมียม กระชับ เน้นภาพสินค้าจริงและจุดเด่นที่มีในข้อมูล",
    config: { durationSec: 20, sceneCount: 4, structure: ["hook", "showcase", "benefit", "cta"], palette: palette("#38347a", "#14546f", "#8d7dfb"), music: "calm" },
  },
  {
    key: "review-style",
    name: "Review Style (สรุปจุดเด่น)",
    style: "review",
    description: "สไตล์รีวิวสั้นแบบ UGC แต่สรุปจากข้อมูลสินค้า/คะแนนรีวิวจริง ไม่แต่งประสบการณ์",
    prompt: "สร้างวิดีโอสไตล์รีวิวสั้น เป็นกันเอง สรุปจุดเด่นและคะแนนรีวิวจากข้อมูลจริง ห้ามอ้างว่าใช้งานเอง",
    config: { durationSec: 20, sceneCount: 4, structure: ["hook", "benefit", "showcase", "cta"], palette: palette("#995ac9", "#f3bb98", "#ffe59b"), music: "upbeat" },
  },
  {
    key: "problem-solution",
    name: "Problem / Solution",
    style: "problem_solution",
    description: "เล่าปัญหาที่พบบ่อย → แสดงสินค้าเป็นทางเลือก โดยไม่อ้างผลเกินจริง",
    prompt: "สร้างวิดีโอแนวปัญหา-ทางออก ระบุปัญหาทั่วไปที่สอดคล้องกับประเภทสินค้า แล้วนำเสนอคุณสมบัติที่ยืนยันได้",
    config: { durationSec: 20, sceneCount: 4, structure: ["hook", "problem", "solution", "cta"], palette: palette("#0a584d", "#13442b", "#7befc2"), music: "calm" },
  },
  {
    key: "promotional",
    name: "Promotional Video",
    style: "promo",
    description: "โทนโปรโมชัน กระตือรือร้น ชวนเช็กราคาปัจจุบันที่ลิงก์",
    prompt: "สร้างวิดีโอโปรโมตสินค้า พลังงานสูง ประโยคสั้น ชวนกดลิงก์ดูโปรและราคาปัจจุบัน ห้ามสร้างส่วนลดที่ไม่มีในข้อมูล",
    config: { durationSec: 15, sceneCount: 3, structure: ["hook", "showcase", "cta"], palette: palette("#7a1f4f", "#e0583a", "#ffe59b"), music: "upbeat" },
  },
  {
    key: "three-benefits",
    name: "สินค้าเด่น 3 จุด",
    style: "three_benefits",
    description: "สรุป 3 จุดเด่นจากข้อมูลสินค้า ฉากละหนึ่งจุด",
    prompt: "สร้างวิดีโอสรุป 3 จุดเด่นของสินค้า ฉากละหนึ่งจุด แต่ละจุดต้องมาจากข้อมูลสินค้าโดยตรง",
    config: { durationSec: 25, sceneCount: 5, structure: ["hook", "benefit", "benefit", "benefit", "cta"], palette: palette("#233f7f", "#14546f", "#59c7f9"), music: "upbeat" },
  },
];
