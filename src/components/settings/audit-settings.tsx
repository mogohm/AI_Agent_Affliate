"use client";
import * as React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { useApi } from "@/lib/client/api";
import { dateTime } from "@/lib/format";

type Log = { id: string; action: string; entityType: string | null; entityId: string | null; metadata: Record<string, unknown> | null; ip: string | null; createdAt: string; userName: string | null; userEmail: string | null };

export function AuditSettings() {
  const [q, setQ] = React.useState("");
  const [action, setAction] = React.useState("");
  const [page, setPage] = React.useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: "30" });
  if (action) qs.set("action", action);
  const r = useApi<{ items: Log[]; total: number; pageSize: number }>(`/api/audit-logs?${qs}`);
  const pages = r.data ? Math.max(1, Math.ceil(r.data.total / r.data.pageSize)) : 1;
  return (
    <div>
      <form
        className="mb-3 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setAction(q.trim());
          setPage(1);
        }}
      >
        <Input placeholder="กรอง action เช่น settings, users, auth.login" value={q} onChange={(e) => setQ(e.target.value)} aria-label="กรอง action" />
        <Button type="submit" variant="outline">
          <Search /> ค้นหา
        </Button>
      </form>
      {r.error && <ErrorState error={r.error} onRetry={r.reload} />}
      {!r.data ? (
        <LoadingRows rows={6} />
      ) : !r.data.items.length ? (
        <EmptyState title="ไม่พบ Audit log" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>เวลา (ไทย)</Th>
                <Th>ผู้ใช้</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>รายละเอียด</Th>
                <Th>IP</Th>
              </tr>
            </THead>
            <tbody>
              {r.data.items.map((l) => (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap text-muted">{dateTime(l.createdAt)}</Td>
                  <Td>{l.userName ?? <span className="text-muted">system</span>}</Td>
                  <Td className="font-mono text-[11px] font-bold">{l.action}</Td>
                  <Td className="text-[11px] text-muted">{l.entityType ? `${l.entityType}:${l.entityId?.slice(0, 8)}` : "—"}</Td>
                  <Td className="max-w-80 truncate font-mono text-[10px] text-muted" title={l.metadata ? JSON.stringify(l.metadata) : ""}>
                    {l.metadata ? JSON.stringify(l.metadata) : "—"}
                  </Td>
                  <Td className="text-[11px] text-muted">{l.ip ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      {r.data && pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ก่อนหน้า
          </Button>
          หน้า {page}/{pages}
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            ถัดไป
          </Button>
        </div>
      )}
    </div>
  );
}
