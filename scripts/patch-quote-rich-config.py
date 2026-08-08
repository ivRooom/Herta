from pathlib import Path

path = Path('apps/studio/src/components/quote-manager.tsx')
text = path.read_text()

text = text.replace(
    "import { useState } from 'react';",
    "import { useState, type KeyboardEvent } from 'react';",
    1,
)

old_create_tags = '''          <label>
            <span className="text-sm font-medium">タグ</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="herta, bot"
            />
          </label>'''
new_create_tags = '''          <div>
            <span className="text-sm font-medium">タグ</span>
            <div className="mt-2">
              <TagEditor value={tags} onChange={setTags} ariaLabel="新しいQuoteのタグ" />
            </div>
          </div>'''
if old_create_tags not in text:
    raise SystemExit('create tag field not found')
text = text.replace(old_create_tags, new_create_tags, 1)

old_create_status = '''          <label>
            <span className="text-sm font-medium">ステータス</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="public">public</option>
              <option value="private">private</option>
              <option value="hidden">hidden</option>
            </select>
          </label>'''
new_create_status = '''          <div className="md:col-span-2">
            <span className="text-sm font-medium">公開範囲</span>
            <div className="mt-2">
              <VisibilityPicker value={status} onChange={setStatus} />
            </div>
          </div>'''
if old_create_status not in text:
    raise SystemExit('create status field not found')
text = text.replace(old_create_status, new_create_status, 1)

text = text.replace(
    '<span className="rounded-full border border-border px-2 py-1">{status}</span>',
    '<span className="rounded-full border border-border px-2 py-1">{visibilityLabel(status)}</span>',
    1,
)

old_edit_tags = '''        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          aria-label={`Quote #${item.quoteNumber} タグ`}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="タグ"
        />'''
new_edit_tags = '''        <TagEditor
          value={tags}
          onChange={setTags}
          ariaLabel={`Quote #${item.quoteNumber} タグ`}
        />'''
if old_edit_tags not in text:
    raise SystemExit('edit tag field not found')
text = text.replace(old_edit_tags, new_edit_tags, 1)

old_edit_status = '''        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label={`Quote #${item.quoteNumber} ステータス`}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="public">public</option>
          <option value="private">private</option>
          <option value="hidden">hidden</option>
        </select>'''
new_edit_status = '''        <VisibilityPicker
          value={status}
          onChange={setStatus}
          ariaLabel={`Quote #${item.quoteNumber} 公開範囲`}
          compact
        />'''
if old_edit_status not in text:
    raise SystemExit('edit status field not found')
text = text.replace(old_edit_status, new_edit_status, 1)

marker = '\nasync function apiRequest(url: string, init: RequestInit): Promise<unknown> {'
if marker not in text:
    raise SystemExit('apiRequest marker not found')

helpers = r'''

const VISIBILITY_OPTIONS = [
  {
    value: 'public',
    label: '公開',
    description: '通常のQuoteとして検索・表示対象にします。',
  },
  {
    value: 'private',
    label: '限定',
    description: '公開一覧から外し、管理用途のQuoteとして保持します。',
  },
  {
    value: 'hidden',
    label: '非表示',
    description: '削除せず完全に表示対象から外します。',
  },
] as const;

function VisibilityPicker({
  value,
  onChange,
  ariaLabel = 'Quoteの公開範囲',
  compact = false,
}: {
  value: string;
  onChange(value: string): void;
  ariaLabel?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`grid gap-2 ${compact ? 'grid-cols-1 sm:grid-cols-3' : 'sm:grid-cols-3'}`}
      role="group"
      aria-label={ariaLabel}
    >
      {VISIBILITY_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              active
                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                : 'border-border bg-background hover:border-primary/40'
            }`}
          >
            <span className="block text-sm font-medium">{option.label}</span>
            {!compact ? (
              <span className="mt-1 block text-xs leading-5 text-muted">{option.description}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function TagEditor({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange(value: string): void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState('');
  const tags = normalizeTags(value);

  function commitTag(raw: string) {
    const normalized = raw.trim().replace(/^#/, '').slice(0, 40);
    if (!normalized) return;
    if (!tags.some((tag) => tag.toLocaleLowerCase('ja') === normalized.toLocaleLowerCase('ja'))) {
      onChange([...tags, normalized].slice(0, 20).join(', '));
    }
    setDraft('');
  }

  function removeTag(tag: string) {
    onChange(tags.filter((candidate) => candidate !== tag).join(', '));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitTag(draft);
      return;
    }
    const lastTag = tags.at(-1);
    if (event.key === 'Backspace' && !draft && lastTag) {
      removeTag(lastTag);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
      {tags.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:border-destructive/40 hover:text-destructive"
              aria-label={`${tag} タグを削除`}
            >
              #{tag} ×
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={ariaLabel}
          className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
          placeholder={tags.length === 0 ? 'タグを入力してEnter' : 'タグを追加'}
          maxLength={40}
        />
        <button
          type="button"
          onClick={() => commitTag(draft)}
          disabled={!draft.trim() || tags.length >= 20}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium disabled:opacity-40"
        >
          追加
        </button>
      </div>
      <p className="mt-1 px-1 text-[11px] text-muted">Enterまたはカンマで追加 · 最大20件</p>
    </div>
  );
}

function normalizeTags(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value.split(',')) {
    const tag = raw.trim().replace(/^#/, '').slice(0, 40);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase('ja');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= 20) break;
  }
  return result;
}

function visibilityLabel(value: string): string {
  return VISIBILITY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
'''

text = text.replace(marker, helpers + marker, 1)
path.write_text(text)
