"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { fieldType, OPERATORS_BY_TYPE, SEGMENT_FIELDS } from "@mailory/core/shared";
import { Button, Field, Input, NativeSelect } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall, STATUS_LABELS, CONSENT_LABELS } from "./labels";

type Rule = {
  type: "rule";
  field: string;
  op: string;
  value?: string | number | string[];
};
type Group = { type: "group"; op: "and" | "or"; not?: boolean; children: Node[] };
type Node = Rule | Group;
type Opt = { id: string; name: string };
type CustomField = { key: string; label: string };

const OP_LABELS: Record<string, string> = {
  eq: "eşittir",
  neq: "eşit değildir",
  contains: "içerir",
  not_contains: "içermez",
  starts_with: "ile başlar",
  is_empty: "boştur",
  is_not_empty: "boş değildir",
  gt: "büyüktür",
  gte: "büyük veya eşittir",
  lt: "küçüktür",
  lte: "küçük veya eşittir",
  before: "tarihinden önce",
  after: "tarihinden sonra",
  in_last_days: "son … günde",
  in: "bunlardan biri",
  not_in: "bunlardan hiçbiri",
};
const MAX_DEPTH = 3;
const emptyRule = (): Rule => ({
  type: "rule",
  field: "company",
  op: "contains",
  value: "",
});
const emptyGroup = (): Group => ({ type: "group", op: "and", children: [emptyRule()] });

function update(node: Node, path: number[], fn: (n: Node) => Node | null): Node | null {
  if (path.length === 0) return fn(node);
  if (node.type !== "group") return node;
  const [head, ...rest] = path as [number, ...number[]];
  const children = node.children
    .map((child, i) => (i === head ? update(child, rest, fn) : child))
    .filter((c): c is Node => c !== null);
  return { ...node, children };
}

export function SegmentBuilder({
  initial,
  customFields,
  lists,
  tags,
  canWrite,
}: {
  initial?: { id: string; name: string; definition: Group };
  customFields: CustomField[];
  lists: Opt[];
  tags: Opt[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [root, setRoot] = useState<Group>(initial?.definition ?? emptyGroup());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{
    count: number;
    sample: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      company: string | null;
    }[];
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const serialized = useMemo(() => JSON.stringify(root), [root]);

  // Live preview, debounced; failures are shown inline rather than blocking editing.
  useEffect(() => {
    const handle = setTimeout(async () => {
      setPreviewing(true);
      const result = await apiCall("/api/segments/preview", "POST", {
        definition: JSON.parse(serialized),
      });
      setPreviewing(false);
      if (result.ok) {
        setPreview(result.data as never);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(result.message);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [serialized]);

  const edit = (path: number[], fn: (n: Node) => Node | null) =>
    setRoot((r) => (update(r, path, fn) as Group) ?? r);

  async function save() {
    setSaving(true);
    setError(null);
    const body = { name, definition: root };
    const result = initial
      ? await apiCall(`/api/segments/${initial.id}`, "PATCH", body)
      : await apiCall("/api/segments", "POST", body);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    router.push("/audience/segments");
    router.refresh();
  }

  const fieldGroups = (
    <>
      <optgroup label="Kişi alanları">
        {SEGMENT_FIELDS.filter((f) => f.type !== "list" && f.type !== "tag").map(
          (f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ),
        )}
      </optgroup>
      {customFields.length ? (
        <optgroup label="Özel alanlar">
          {customFields.map((f) => (
            <option key={f.key} value={`custom.${f.key}`}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="Üyelik">
        <option value="list">Liste</option>
        <option value="tag">Etiket</option>
      </optgroup>
    </>
  );

  // Plain render functions (not nested components): a component type defined inside render would remount
  // on every keystroke and steal focus from the input being typed in.
  function renderRule(rule: Rule, path: number[]) {
    const type = fieldType(rule.field) ?? "text";
    const ops = OPERATORS_BY_TYPE[type].filter((o) => !(type === "enum" && o === "in"));
    const needsValue = rule.op !== "is_empty" && rule.op !== "is_not_empty";
    const label = `Koşul ${path.map((p) => p + 1).join(".")}`;
    const setRule = (patch: Partial<Rule>) =>
      edit(path, (n) => ({ ...(n as Rule), ...patch }));

    return (
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={label}
      >
        <NativeSelect
          aria-label={`${label} alanı`}
          value={rule.field}
          onChange={(e) => {
            const nextType = fieldType(e.target.value) ?? "text";
            const nextOps = OPERATORS_BY_TYPE[nextType].filter(
              (o) => !(nextType === "enum" && o === "in"),
            );
            setRule({
              field: e.target.value,
              op: nextOps[0],
              value: nextType === "list" || nextType === "tag" ? [] : "",
            });
          }}
        >
          {fieldGroups}
        </NativeSelect>
        <NativeSelect
          aria-label={`${label} işlemi`}
          value={rule.op}
          onChange={(e) => setRule({ op: e.target.value })}
        >
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_LABELS[o] ?? o}
            </option>
          ))}
        </NativeSelect>
        {needsValue ? (
          type === "list" || type === "tag" ? (
            <NativeSelect
              aria-label={`${label} değeri`}
              value={Array.isArray(rule.value) ? (rule.value[0] ?? "") : ""}
              onChange={(e) =>
                setRule({ value: e.target.value ? [e.target.value] : [] })
              }
            >
              <option value="">Seçin…</option>
              {(type === "list" ? lists : tags).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          ) : type === "enum" ? (
            <NativeSelect
              aria-label={`${label} değeri`}
              value={String(rule.value ?? "")}
              onChange={(e) => setRule({ value: e.target.value })}
            >
              <option value="">Seçin…</option>
              {(
                (
                  SEGMENT_FIELDS.find((f) => f.key === rule.field) as
                    | { options?: readonly string[] }
                    | undefined
                )?.options ?? []
              ).map((o) => (
                <option key={o} value={o}>
                  {STATUS_LABELS[o] ?? CONSENT_LABELS[o] ?? o}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input
              aria-label={`${label} değeri`}
              className="w-48"
              type={
                type === "number" ||
                rule.op === "in_last_days" ||
                (type === "custom" && ["gt", "gte", "lt", "lte"].includes(rule.op))
                  ? "number"
                  : type === "date"
                    ? "date"
                    : "text"
              }
              value={
                typeof rule.value === "string" || typeof rule.value === "number"
                  ? rule.value
                  : ""
              }
              onChange={(e) => {
                const numeric = e.target.type === "number";
                setRule({
                  value:
                    numeric && e.target.value !== ""
                      ? Number(e.target.value)
                      : e.target.value,
                });
              }}
            />
          )
        ) : null}
        {rule.op === "in_last_days" ? (
          <span className="text-sm text-muted-foreground">gün</span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${label} sil`}
          onClick={() => edit(path, () => null)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    );
  }

  function renderGroup(group: Group, path: number[]) {
    const depth = path.length;
    return (
      <div
        className={
          depth === 0
            ? "flex flex-col gap-3"
            : "flex flex-col gap-3 rounded-lg border bg-surface-muted p-3"
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Şu koşulların</span>
          <NativeSelect
            aria-label="Grup mantığı"
            value={group.op}
            onChange={(e) =>
              edit(path, (n) => ({
                ...(n as Group),
                op: e.target.value as "and" | "or",
              }))
            }
          >
            <option value="and">tümü</option>
            <option value="or">herhangi biri</option>
          </NativeSelect>
          <span>sağlanmalı</span>
          <label className="ml-2 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={Boolean(group.not)}
              onChange={(e) =>
                edit(path, (n) => ({ ...(n as Group), not: e.target.checked }))
              }
            />
            <span>Sonucu tersine çevir (DEĞİL)</span>
          </label>
          {depth > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => edit(path, () => null)}
            >
              <Trash2 aria-hidden="true" /> Grubu sil
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 border-l-2 pl-4">
          {group.children.map((child, i) =>
            child.type === "rule"
              ? renderRule(child, [...path, i])
              : renderGroup(child, [...path, i]),
          )}
          {group.children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Bu grupta koşul yok; en az bir koşul ekleyin.
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              edit(path, (n) => ({
                ...(n as Group),
                children: [...(n as Group).children, emptyRule()],
              }))
            }
          >
            <Plus aria-hidden="true" /> Koşul ekle
          </Button>
          {depth < MAX_DEPTH ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                edit(path, (n) => ({
                  ...(n as Group),
                  children: [...(n as Group).children, emptyGroup()],
                }))
              }
            >
              <Plus aria-hidden="true" /> Grup ekle
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        <Field id="seg-name" label="Segment adı" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            disabled={!canWrite}
            placeholder="Örn. Aktif teknoloji girişimleri"
          />
        </Field>
        <div className="rounded-lg border bg-surface p-4">{renderGroup(root, [])}</div>
        {canWrite ? (
          <div className="flex gap-2">
            <Button
              onClick={save}
              disabled={saving || !name.trim() || Boolean(previewError)}
            >
              {saving ? "Kaydediliyor…" : "Segmenti kaydet"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push("/audience/segments")}
            >
              Vazgeç
            </Button>
          </div>
        ) : null}
      </div>
      <aside
        aria-label="Önizleme"
        className="h-fit rounded-lg border bg-surface p-4 lg:sticky lg:top-6"
      >
        <h2 className="text-sm font-semibold">Önizleme</h2>
        <div aria-live="polite" className="mt-2">
          {previewError ? (
            <p role="alert" className="text-sm text-danger">
              {previewError}
            </p>
          ) : preview ? (
            <>
              <p
                className={
                  previewing
                    ? "text-3xl font-extrabold tabular-nums opacity-60"
                    : "text-3xl font-extrabold tabular-nums"
                }
              >
                {preview.count.toLocaleString("tr-TR")}
              </p>
              <p className="text-sm text-muted-foreground">eşleşen kişi</p>
              {preview.sample.length ? (
                <ul className="mt-3 flex flex-col gap-1 text-sm">
                  {preview.sample.map((s) => (
                    <li key={s.id} className="truncate" title={s.email}>
                      {[s.firstName, s.lastName].filter(Boolean).join(" ") || s.email}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Hesaplanıyor…</p>
          )}
        </div>
      </aside>
    </div>
  );
}
